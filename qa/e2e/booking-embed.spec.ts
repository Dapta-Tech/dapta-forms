import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Booking embed flow on the public form.
 *
 * A fresh form is created per test via the admin API: one scored
 * multiple_choice (hot=10 / cold=0 / disq=0) + one email step, with outcomes
 *   p1 (>=5)  → HubSpot Meetings embed + redirect after booking
 *   p3 (>=0)  → Calendly embed (no redirect)
 *   p0        → answer-forced disqualify (pick=disq), no booking, no redirect
 *
 * ALL third-party hosts are intercepted with page.route:
 *   - example.com          → stub 200 (so the post-booking redirect can land)
 *   - *.hubspot.com        → stub 200 (so the meetings iframe "loads")
 *   - everything else      → aborted (Calendly's widget.js abort exercises the
 *                            renderer's plain-link fallback)
 *
 * Provider "booked" signals are simulated with synthetic MessageEvents carrying
 * the allowlisted origins (window.postMessage from page context would carry the
 * page origin and is — correctly — ignored by the listener).
 */

const API = 'http://localhost:4400';
const HUBSPOT_URL = 'https://meetings.hubspot.com/example/p1';
const CALENDLY_URL = 'https://calendly.com/example/15min';
const REDIRECT_URL = 'https://example.com/typ-p1';

// better-sqlite3 is a dependency of @quill/db and pnpm does not hoist it to the
// repo root — resolve it through the package that owns it (readonly access only).
const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const requireFromDb = createRequire(
  path.join(SPEC_DIR, '..', '..', 'packages', 'db', 'package.json'),
);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const Database = requireFromDb('better-sqlite3');
const DB_PATH = path.join(SPEC_DIR, '..', '..', '.data', 'qa.db');

// Multiple QA agents share one public-API rate-limit bucket; individual
// requests can be slow or bounced — give tests headroom over the 30s default.
test.beforeEach(() => {
  test.setTimeout(90_000);
});

function queryOne(sql: string, ...params: unknown[]): Record<string, unknown> | undefined {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
  } finally {
    db.close();
  }
}

function bookingFormConfig() {
  return {
    version: 1,
    steps: [
      {
        key: 'pick',
        type: 'multiple_choice',
        question: 'How warm is this lead?',
        flowGroup: 'qualification',
        options: [
          { label: 'Hot', value: 'hot', points: 10 },
          { label: 'Cold', value: 'cold', points: 0 },
          { label: 'Disq', value: 'disq', points: 0 },
        ],
      },
      {
        key: 'email',
        type: 'email',
        question: 'Your work email?',
        required: true,
        flowGroup: 'lead_capture',
      },
    ],
    scoring: { enabled: true },
    outcomes: [
      {
        id: 'p1',
        label: 'P1',
        minScore: 5,
        redirectUrl: REDIRECT_URL,
        booking: { provider: 'hubspot_meetings', url: HUBSPOT_URL, prefill: true },
      },
      {
        id: 'p3',
        label: 'P3',
        minScore: 0,
        booking: { provider: 'calendly', url: CALENDLY_URL, prefill: true },
      },
      {
        id: 'p0',
        label: 'P0',
        minScore: -100,
        overrides: [{ field: 'pick', values: ['disq'] }],
      },
    ],
  };
}

async function createForm(
  request: APIRequestContext,
  tag: string,
): Promise<{ id: string; slug: string; accountCode: string }> {
  const res = await request.post(`${API}/v1/forms`, {
    data: { name: `qa-booking-${tag}-${Date.now()}`, config: bookingFormConfig() },
  });
  expect(res.ok(), `POST /v1/forms failed with ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string; accountId: string };
  // The local auth stub's principal is NOT necessarily the seeded `acme`
  // account — resolve the public account code for the form's actual owner.
  const account = queryOne(`SELECT code FROM account WHERE id = ?`, body.accountId);
  expect(account?.code, `account code for ${body.accountId}`).toBeTruthy();
  return { id: body.id, slug: body.slug, accountCode: String(account!.code) };
}

/** Never let a real third-party request through; stub what the tests observe. */
async function blockExternals(page: Page): Promise<void> {
  await page.route('**/*', (route) => {
    const { hostname } = new URL(route.request().url());
    if (hostname === 'localhost' || hostname === '127.0.0.1') return route.continue();
    if (hostname === 'example.com') {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>stub</title><p>redirect landed (stub)</p>',
      });
    }
    if (hostname.endsWith('hubspot.com')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>hs stub</title><p>meetings embed (stub)</p>',
      });
    }
    // Calendly script/assets and any other third party: fail fast.
    return route.abort();
  });
}

// The public API is rate-limited per IP (token bucket: 60 burst, 1/s refill)
// and EVERY concurrently-running QA spec funnels through the same Next server
// IP, so 429s can surface mid-flow (page 404s or an inline submit error).
// Retry with a refill pause instead of failing on shared-bucket contention.

/** Load the public form, retrying when a 429 turned the page into a 404. */
async function openForm(
  page: Page,
  form: { slug: string; accountCode: string },
  choice: string,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    await page.goto(`/${form.accountCode}/me/${form.slug}`);
    try {
      await page.getByRole('radio', { name: choice }).waitFor({ state: 'visible', timeout: 8_000 });
      return;
    } catch (err) {
      if (attempt >= 3) throw err;
      await page.waitForTimeout(4_000); // let the shared token bucket refill
    }
  }
}

/** Click Submit; when the rate limiter bounces it, wait for refill and retry. */
async function submitWithRetry(page: Page): Promise<void> {
  const inlineError = page.locator('.pf__fields .pf__error');
  for (let attempt = 0; ; attempt += 1) {
    await page.locator('.pf__btn--inline').click();
    // Settle on: booking screen / done screen (success) or the inline error.
    const settled = page
      .locator('[data-testid="booking-screen"], .pf-done__title, .pf__fields .pf__error')
      .first();
    await settled.waitFor({ state: 'visible', timeout: 15_000 });
    const failed = await inlineError.isVisible().catch(() => false);
    if (!failed) return;
    if (attempt >= 4) throw new Error('submit kept failing (public API rate limit?)');
    await page.waitForTimeout(4_000);
  }
}

/** Walk the two-step form: pick a choice (auto-advances), then submit an email. */
async function answerAndSubmit(
  page: Page,
  form: { slug: string; accountCode: string },
  choice: 'Hot' | 'Cold' | 'Disq',
  email: string,
): Promise<void> {
  await openForm(page, form, choice);
  await page.getByRole('radio', { name: choice }).click();
  const emailInput = page.locator('input[type="email"]');
  await emailInput.fill(email);
  await submitWithRetry(page);
}

test('hot lead embeds the HubSpot meetings iframe with prefill, without redirecting', async ({
  page,
  request,
}) => {
  const form = await createForm(request, 'hot');
  await blockExternals(page);
  await answerAndSubmit(page, form, 'Hot', 'qa-hot@example.com');

  const iframe = page.getByTestId('booking-iframe-hubspot');
  await expect(iframe).toBeVisible({ timeout: 15_000 });

  const src = await iframe.getAttribute('src');
  expect(src, 'iframe src').toBeTruthy();
  expect(src).toContain('meetings.hubspot.com/example/p1');
  const embedUrl = new URL(src!);
  expect(embedUrl.searchParams.get('embed')).toBe('true');
  expect(embedUrl.searchParams.get('email')).toBe('qa-hot@example.com');

  // The p1 redirectUrl must NOT fire while the booking screen is up.
  expect(page.url()).toContain('localhost:3400');
});

test('synthetic HubSpot booked message redirects to the outcome redirectUrl', async ({
  page,
  request,
}) => {
  const form = await createForm(request, 'booked-redirect');
  await blockExternals(page);
  await answerAndSubmit(page, form, 'Hot', 'qa-booked@example.com');
  await expect(page.getByTestId('booking-iframe-hubspot')).toBeVisible({ timeout: 15_000 });

  // The listener is origin-allowlisted: dispatch a MessageEvent that carries
  // the provider origin (plain postMessage would carry the page origin).
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://meetings.hubspot.com',
        data: { meetingBookSucceeded: true },
      }),
    );
  });

  // example.com is stubbed by page.route, so the attempted navigation lands.
  await page.waitForURL(REDIRECT_URL, { timeout: 15_000 });
});

test('cold lead shows the Calendly embed (fallback link when the script is blocked)', async ({
  page,
  request,
}) => {
  const form = await createForm(request, 'cold');
  await blockExternals(page);
  await answerAndSubmit(page, form, 'Cold', 'qa-cold@example.com');

  await expect(page.getByTestId('booking-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('booking-embed-calendly')).toBeAttached();

  // widget.js is aborted by the route → the renderer must fall back to a plain
  // scheduling link that still points at the configured Calendly event.
  const fallbackLink = page.locator('.pf-booking__fallback a');
  await expect(fallbackLink).toBeVisible({ timeout: 15_000 });
  const href = await fallbackLink.getAttribute('href');
  expect(href).toContain('calendly.com/example/15min');
});

test('disqualified answer resolves P0 with no booking UI', async ({ page, request }) => {
  const form = await createForm(request, 'disq');
  await blockExternals(page);
  await answerAndSubmit(page, form, 'Disq', 'qa-disq@example.com');

  // Straight to the done screen: P0 has no booking and no redirectUrl.
  await expect(page.locator('.pf-done__title')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.pf-done__title')).toHaveText('P0');
  await expect(page.getByTestId('booking-screen')).toHaveCount(0);
  expect(page.url()).toContain('localhost:3400');
});

test('booked event persists a booking_event row and enqueues a booking_sync outbox row', async ({
  page,
  request,
}) => {
  const form = await createForm(request, 'db-rows');
  const formId = form.id;
  await blockExternals(page);

  // The renderer's booking callback POST is best-effort (a 429 under parallel
  // QA load is silently dropped), so retry the whole booked flow until the
  // durable booking_event row lands.
  let bookingRow: Record<string, unknown> | undefined;
  let sessionId: string | null = null;
  for (let attempt = 0; attempt < 3 && !bookingRow; attempt += 1) {
    await answerAndSubmit(page, form, 'Cold', 'qa-db@example.com');
    await expect(page.getByTestId('booking-embed-calendly')).toBeAttached({ timeout: 15_000 });

    sessionId = await page.evaluate(
      (f) => window.sessionStorage.getItem(`quill-form-${f.accountCode}-${f.slug}`),
      { accountCode: form.accountCode, slug: form.slug },
    );
    expect(sessionId, 'renderer sessionId').toBeTruthy();

    await page.evaluate(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://calendly.com',
          data: {
            event: 'calendly.event_scheduled',
            payload: {
              event: { uri: 'https://api.calendly.com/scheduled_events/EV1' },
              invitee: { uri: 'https://api.calendly.com/scheduled_events/EV1/invitees/INV1' },
            },
          },
        }),
      );
    });

    // p3 has no redirectUrl: after the callback is reported the done screen shows.
    await expect(page.locator('.pf-done__title')).toBeVisible({ timeout: 15_000 });

    const deadline = Date.now() + 10_000;
    while (!bookingRow && Date.now() < deadline) {
      bookingRow = queryOne(
        `SELECT id, provider, event_uri FROM booking_event WHERE form_id = ? AND session_id = ?`,
        formId,
        sessionId,
      );
      if (!bookingRow) await page.waitForTimeout(500);
    }
  }

  expect(bookingRow, 'booking_event row for this form + session').toBeTruthy();
  expect(bookingRow!.provider).toBe('calendly');
  expect(bookingRow!.event_uri).toBe('https://api.calendly.com/scheduled_events/EV1');

  await expect
    .poll(
      () =>
        queryOne(
          `SELECT id, kind, action FROM outbox WHERE kind = ? AND subject_uid = ?`,
          'booking_sync',
          bookingRow!.id,
        ) ?? null,
      { timeout: 15_000, message: 'outbox booking_sync row for the booking event' },
    )
    .toBeTruthy();
});
