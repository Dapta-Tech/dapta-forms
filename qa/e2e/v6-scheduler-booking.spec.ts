import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
// better-sqlite3 lives under packages/db (pnpm doesn't hoist it).
const requireFromDb = createRequire(path.resolve(SPEC_DIR, '../../packages/db/package.json'));
const Database = requireFromDb('better-sqlite3') as new (
  filename: string,
  options?: { readonly?: boolean },
) => {
  prepare(sql: string): { get(...params: unknown[]): unknown };
  close(): void;
};

/**
 * V6 — booking a SCHEDULER step, end to end, with NO Calendly token.
 *
 * The whole point of the scheduler being a step is that booking it behaves like
 * answering any other question. This proves that without touching Calendly:
 *
 *  - `window.Calendly` is stubbed before load, so the real widget script is
 *    never fetched (loadCalendlyScript short-circuits on an existing global).
 *    The stub also captures what the embed was asked to prefill.
 *  - the booking itself is simulated by dispatching the exact MessageEvent the
 *    renderer listens for (origin-checked `calendly.event_scheduled`).
 *
 * Then the DURABLE facts are asserted straight from the QA SQLite file:
 *  1. a booking_event row for the session (provider/event uri/start time),
 *  2. the submission is COMPLETE (completed_at set) when the scheduler is the
 *     last step — "booking → submit the form", via the normal last-step path,
 *  3. the booked slot is stored as that step's ANSWER,
 *  4. a scheduler in the MIDDLE does not complete the form — it just advances,
 *     which is what makes "complete on booking" a logic decision, not a rule.
 */

const API = 'http://localhost:4400';
const DB_PATH = path.resolve(SPEC_DIR, '../../.data/qa.db');
const RUN = randomUUID().slice(0, 8);
let seq = 0;

const START_TIME = '2026-09-01T15:00:00.000Z';
const EVENT_URI = 'https://api.calendly.com/scheduled_events/EV-V6';
const INVITEE_URI = `${EVENT_URI}/invitees/IN-V6`;
const SCHED_Q = 'Separa tu puesto ahora';

function queryOne<T>(sqlText: string, ...params: unknown[]): T | undefined {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return db.prepare(sqlText).get(...params) as T | undefined;
  } finally {
    db.close();
  }
}

async function accountCode(request: APIRequestContext): Promise<string> {
  const me = (await (await request.get(`${API}/v1/me`)).json()) as {
    accountCode?: string;
    accountShortCode?: string;
  };
  return (me.accountCode ?? me.accountShortCode) as string;
}

/** A form whose scheduler sits either last or mid-form, with a prefill mapping. */
async function createForm(
  request: APIRequestContext,
  opts: { schedulerLast: boolean; submitOnBooking?: boolean },
): Promise<{ id: string; slug: string }> {
  seq += 1;
  const scheduler = {
    key: 'book',
    type: 'scheduler',
    question: SCHED_Q,
    required: true,
    // "After booking → submit the form": a catch-all rule, since a booking has
    // no option value to branch on.
    ...(opts.submitOnBooking ? { goto: [{ values: ['*'], target: null }] } : {}),
    scheduler: {
      provider: 'calendly',
      url: 'https://calendly.com/acme/intro',
      prefill: true,
      // Deliberately NON-conventional keys, so this only works via the mapping.
      // The phone rides `a2` — this event type's SECOND custom question — which
      // is exactly what the old hardcoded `a1` guess got wrong.
      prefillMap: { name: 'quien', email: 'correo', a2: 'celular' },
    },
  };
  const tail = { key: 'after', type: 'text', question: 'Anything else?' };
  const steps = [
    { key: 'quien', type: 'text', question: 'Your full name', required: true },
    { key: 'correo', type: 'email', question: 'Work email', required: true },
    { key: 'celular', type: 'text', question: 'Phone' },
    ...(opts.schedulerLast ? [scheduler] : [scheduler, tail]),
  ];
  const res = await request.post(`${API}/v1/forms`, {
    data: { name: `v6book-${RUN}-${seq}`, config: { version: 1, steps } },
  });
  expect(res.ok(), `create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string; slug: string };
}

/** Stub the Calendly global BEFORE any page script runs (no network at all). */
async function stubCalendly(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      Calendly: unknown;
      __calendlyInit: { url: string; prefill: unknown } | null;
    };
    w.__calendlyInit = null;
    w.Calendly = {
      initInlineWidget: (opts: {
        url: string;
        parentElement?: HTMLElement;
        prefill?: unknown;
      }) => {
        w.__calendlyInit = { url: opts.url, prefill: opts.prefill ?? null };
        if (opts.parentElement) {
          opts.parentElement.innerHTML = '<div data-testid="calendly-stub">stub</div>';
        }
      },
    };
  });
}

/**
 * Dispatch the exact message Calendly posts when an invitee books.
 *
 * Waits for the embed to have initialised first: the message listener and the
 * widget init are both mount effects, so firing before the widget exists means
 * firing before anything is listening — the event would be dropped and the test
 * would fail intermittently rather than deterministically.
 */
async function simulateBooking(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __calendlyInit: unknown }).__calendlyInit !== null,
    undefined,
    { timeout: 20_000 },
  );
  await page.evaluate(
    ([eventUri, inviteeUri, startTime]) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://calendly.com',
          data: {
            event: 'calendly.event_scheduled',
            payload: {
              event: { uri: eventUri, start_time: startTime },
              invitee: { uri: inviteeUri },
            },
          },
        }),
      );
    },
    [EVENT_URI, INVITEE_URI, START_TIME] as const,
  );
}

/** Seconds of refill to bank when the bucket is found empty — one walk (page
 *  render, per-step events, the booking record, the submit) costs about this. */
const BANK_MS = 20_000;

/**
 * Wait for the shared public-API bucket to have room for a whole walk.
 *
 * The public controller is rate-limited per IP — a token bucket of 60 with a
 * 1/s refill (`RATE_LIMIT_CAPACITY` / `RATE_LIMIT_REFILL_PER_SEC`) — and every
 * QA spec drains the SAME bucket, because all public traffic reaches the API
 * from the Next server, not the browser. A spec that walks several forms
 * (v5-reveal-positions walks nine) leaves it at zero, and the next spec starts
 * throttled.
 *
 * A throttled page LOAD is recoverable (`openFirstStep` reloads). A throttled
 * SUBMIT is not: `handleSchedulerBooked` marks the step booked before it posts
 * and never runs twice, so re-dispatching the Calendly message is ignored and
 * the run strands on the scheduler step with no `.pf-done__title` — exactly the
 * ~20s timeout this spec kept showing in full-suite runs (reproducible by
 * draining the bucket with 60 requests first). So check BEFORE walking, and
 * bank enough refill to finish, rather than discovering it at the submit.
 */
async function awaitPublicApiHeadroom(page: Page, url: string): Promise<void> {
  const [, code, , slug] = url.split('/');
  const probe = `${API}/v1/public/forms/${encodeURIComponent(code)}/${encodeURIComponent(slug)}`;
  // A single probe cannot tell "full" from "one token left", so put the bucket
  // in a KNOWN state instead of guessing: spend it down to empty, then wait a
  // fixed refill. The walk then starts with a budget this spec chose rather than
  // whatever the previous spec happened to leave behind.
  for (let i = 0; i < 80; i += 1) {
    const res = await page.request.get(probe);
    if (res.status() === 429) break;
  }
  await page.waitForTimeout(BANK_MS);
}

/**
 * Open the public form's FIRST step.
 *
 * Even with the headroom check above, a 429 on the page's server-side config
 * fetch renders the Not-found page with no `.pf__fields` at all, so a naive
 * assertion just times out. Reload after a refill pause instead of failing on an
 * environmental throttle (same pattern as builder-gaps' `gotoPublic`).
 */
async function openFirstStep(page: Page, url: string): Promise<void> {
  const input = page.locator('.pf__fields input, .pf__fields textarea').first();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.goto(url);
    try {
      await expect(input).toBeVisible({ timeout: 5_000 });
      return;
    } catch {
      await page.waitForTimeout(5_000); // let the rate-limit bucket refill
    }
  }
  await expect(input).toBeVisible({ timeout: 20_000 });
}

/** Walk the three lead questions and land on the scheduler step. */
async function reachScheduler(page: Page, url: string): Promise<void> {
  await awaitPublicApiHeadroom(page, url);
  await openFirstStep(page, url);
  for (const value of ['Ada Lovelace', 'ada@acme.io', '+13105551234']) {
    const input = page.locator('.pf__fields input, .pf__fields textarea').first();
    await expect(input).toBeVisible({ timeout: 20_000 });
    await input.fill(value);
    await page.locator('.pf__btn--inline, .pf__btn').first().click();
  }
  await expect(page.locator('.pf__question')).toHaveText(SCHED_Q, { timeout: 20_000 });
}

const sessionIdOf = (page: Page, code: string, slug: string): Promise<string> =>
  page.evaluate(
    ([c, s]) => window.sessionStorage.getItem(`quill-form-${c}-${s}`) ?? '',
    [code, slug] as const,
  );

test.describe('V6 — booking a scheduler step (no Calendly token)', () => {
  test.setTimeout(90_000);

  test('booking the LAST step records the meeting AND completes the submission', async ({
    page,
    request,
  }) => {
    const code = await accountCode(request);
    const { slug } = await createForm(request, { schedulerLast: true });
    await stubCalendly(page);
    await reachScheduler(page, `/${code}/you/${slug}`);

    // The embed was initialised with the MAPPED contact details — the form uses
    // quien/correo/celular, none of which are the conventional prefill keys.
    const init = await page.evaluate(
      () => (window as unknown as { __calendlyInit: { url: string; prefill: Record<string, unknown> } | null }).__calendlyInit,
    );
    expect(init, 'the embed must have been initialised').toBeTruthy();
    expect(init!.prefill).toMatchObject({
      name: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@acme.io',
    });
    // The phone landed on a2 — the id the mapping named — not the guessed a1.
    const custom = (init!.prefill as { customAnswers?: Record<string, string> }).customAnswers ?? {};
    expect(custom.a2).toBe('+13105551234');
    expect(custom.a1).toBeUndefined();

    const sessionId = await sessionIdOf(page, code, slug);
    expect(sessionId).toBeTruthy();

    await simulateBooking(page);

    // Booking the last step submits the form: the thank-you screen renders.
    await expect(page.locator('.pf-done__title')).toBeVisible({ timeout: 20_000 });

    // 1. The meeting is durably recorded.
    await expect
      .poll(
        () =>
          queryOne<{ provider: string; event_uri: string | null; start_time: number | null }>(
            'SELECT provider, event_uri, start_time FROM booking_event WHERE session_id = ?',
            sessionId,
          ),
        { timeout: 15_000, message: 'a booking_event row must be persisted' },
      )
      .toMatchObject({ provider: 'calendly', event_uri: EVENT_URI });
    const bookingRow = queryOne<{ start_time: number | null }>(
      'SELECT start_time FROM booking_event WHERE session_id = ?',
      sessionId,
    );
    expect(bookingRow!.start_time).toBe(Date.parse(START_TIME));

    // The CRM write-back rides the SAME outbox as any other booking, so a
    // scheduler booking stamps the meeting onto the contact exactly like the
    // post-outcome handoff always did.
    const outbox = queryOne<{ kind: string; action: string }>(
      `SELECT kind, action FROM outbox
         WHERE subject_uid = (SELECT id FROM booking_event WHERE session_id = ?)`,
      sessionId,
    );
    expect(outbox, 'a booking_sync outbox row must be enqueued').toBeTruthy();
    expect(outbox!.kind).toBe('booking_sync');
    expect(outbox!.action).toBe('crm_update');

    // 2 + 3. The submission is COMPLETE and carries the booked slot as the answer.
    await expect
      .poll(
        () =>
          queryOne<{ completed_at: number | null; data: string }>(
            'SELECT completed_at, data FROM submission WHERE session_id = ?',
            sessionId,
          )?.completed_at ?? null,
        { timeout: 15_000, message: 'booking the last step must COMPLETE the submission' },
      )
      .not.toBeNull();

    const sub = queryOne<{ data: string }>(
      'SELECT data FROM submission WHERE session_id = ?',
      sessionId,
    );
    expect(JSON.parse(sub!.data).book).toBe(START_TIME);
  });

  test('"Automatic" prefills from the contact QUESTIONS, with no mapping at all', async ({
    page,
    request,
  }) => {
    const code = await accountCode(request);
    seq += 1;
    // A form as the builder actually makes one: generated keys, none of them the
    // conventional firstname/email the old extraction looked for, and NO
    // prefillMap — everything left on "Automatic".
    const res = await request.post(`${API}/v1/forms`, {
      data: {
        name: `v6auto-${RUN}-${seq}`,
        config: {
          version: 1,
          steps: [
            { key: 'name_1', type: 'name', question: 'Your name', fields: ['firstname', 'lastname'] },
            { key: 'email_2', type: 'email', question: 'Work email', required: true },
            {
              key: 'book',
              type: 'scheduler',
              question: SCHED_Q,
              required: true,
              scheduler: { provider: 'calendly', url: 'https://calendly.com/acme/intro', prefill: true },
            },
          ],
        },
      },
    });
    const { slug } = (await res.json()) as { slug: string };

    await stubCalendly(page);
    await page.goto(`/${code}/you/${slug}`);
    // Name step first (two subfield inputs), then the email.
    const first = page.locator('.pf__fields input').first();
    await expect(first).toBeVisible({ timeout: 20_000 });
    await first.fill('Ada');
    await page.locator('.pf__fields input').nth(1).fill('Lovelace');
    await page.locator('.pf__btn--inline, .pf__btn').first().click();
    const email = page.locator('.pf__fields input').first();
    await expect(email).toBeVisible({ timeout: 20_000 });
    await email.fill('ada@acme.io');
    await page.locator('.pf__btn--inline, .pf__btn').first().click();
    await expect(page.locator('.pf__question')).toHaveText(SCHED_Q, { timeout: 20_000 });

    await page.waitForFunction(
      () => (window as unknown as { __calendlyInit: unknown }).__calendlyInit !== null,
      undefined,
      { timeout: 20_000 },
    );
    const init = await page.evaluate(
      () =>
        (window as unknown as { __calendlyInit: { prefill: Record<string, unknown> } | null })
          .__calendlyInit,
    );
    // The email came from the email QUESTION (`email_2`), not a literal `email` key.
    expect(init!.prefill).toMatchObject({
      name: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@acme.io',
    });
  });

  test('booking a MID-form scheduler advances instead of submitting', async ({ page, request }) => {
    const code = await accountCode(request);
    const { slug } = await createForm(request, { schedulerLast: false });
    await stubCalendly(page);
    await reachScheduler(page, `/${code}/you/${slug}`);
    const sessionId = await sessionIdOf(page, code, slug);

    await simulateBooking(page);

    // It moves on to the next question — no thank-you screen yet.
    await expect(page.locator('.pf__question')).toHaveText('Anything else?', { timeout: 20_000 });
    await expect(page.locator('.pf-done__title')).toHaveCount(0);

    // The meeting is still recorded immediately (the CRM write-back does not
    // wait for the form to finish)…
    await expect
      .poll(
        () =>
          queryOne<{ provider: string }>(
            'SELECT provider FROM booking_event WHERE session_id = ?',
            sessionId,
          )?.provider ?? null,
        { timeout: 15_000, message: 'the booking must be recorded even mid-form' },
      )
      .toBe('calendly');

    // …while the submission is NOT complete yet.
    const sub = queryOne<{ completed_at: number | null }>(
      'SELECT completed_at FROM submission WHERE session_id = ?',
      sessionId,
    );
    expect(sub?.completed_at ?? null, 'a mid-form booking must not complete the form').toBeNull();
  });

  test('"After booking → submit" ends a MID-form scheduler on the spot', async ({
    page,
    request,
  }) => {
    const code = await accountCode(request);
    // Same mid-form shape as above (a question still follows it) — the only
    // difference is the catch-all rule the After-booking picker writes.
    const { slug } = await createForm(request, { schedulerLast: false, submitOnBooking: true });
    await stubCalendly(page);
    await reachScheduler(page, `/${code}/you/${slug}`);
    const sessionId = await sessionIdOf(page, code, slug);

    await simulateBooking(page);

    // It does NOT walk on to "Anything else?" — it submits and shows the ending.
    await expect(page.locator('.pf-done__title')).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(
        () =>
          queryOne<{ completed_at: number | null }>(
            'SELECT completed_at FROM submission WHERE session_id = ?',
            sessionId,
          )?.completed_at ?? null,
        { timeout: 15_000, message: 'the catch-all rule must complete the submission' },
      )
      .not.toBeNull();
  });
});
