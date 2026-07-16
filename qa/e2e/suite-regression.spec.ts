import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Cross-feature regression net over the IMPORTED pilot-style form
 * (`/<accountCode>/me/pilot-lead-qualifier`, created by qa/import-pilot-form.ts;
 * accountCode resolved from GET /v1/me):
 *
 *   1. cover renders + start works
 *   2. qualified walk → question variants → reveal interstitial → booking screen
 *   3. disqualified walk → terminal message step → redirect, NO booking
 *   4. personal-email branch inserts the website step before phone
 *      (the corporate-email walk in #2 asserts it stays hidden)
 *   5. funnel integrity: exactly ONE `submit` form_event per completed session
 *      (the pilot double-fired submit client+server — must never regress)
 *
 * Sessions are unique per run (sessionStorage UUID per fresh context), so the
 * spec is idempotent against the shared imported form.
 */

// The imported pilot form belongs to the local principal's account — resolve
// its code from GET /v1/me (per QA conventions the principal may NOT be
// `acme`; on some QA instances the import ran under a generated code).
const PILOT_SLUG = 'pilot-lead-qualifier';
let FORM_PATH = ''; // `/<accountCode>/me/pilot-lead-qualifier`, set in beforeAll
let SESSION_KEY = ''; // `quill-form-<accountCode>-pilot-lead-qualifier`
const RUN_ID = Date.now(); // marks this run's answers for debuggability

test.beforeAll(async ({ request }) => {
  const res = await request.get('http://localhost:4400/v1/me');
  expect(res.ok(), `GET /v1/me failed: ${res.status()}`).toBeTruthy();
  const { accountCode } = (await res.json()) as { accountCode: string };
  FORM_PATH = `/${accountCode}/me/${PILOT_SLUG}`;
  SESSION_KEY = `quill-form-${accountCode}-${PILOT_SLUG}`;
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DB_PATH = path.join(ROOT, '.data', 'qa.db');

// pnpm keeps better-sqlite3 unhoisted; resolve it through the package that owns it.
const nodeRequire = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Database: any = nodeRequire(path.join(ROOT, 'packages', 'db', 'node_modules', 'better-sqlite3'));

/** Open a fresh readonly connection per query so each poll sees committed writes. */
function withDb<T>(fn: (db: InstanceType<typeof Database>) => T): T {
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function submitEventCount(sessionId: string): number {
  return withDb(
    (db) =>
      (db
        .prepare(`SELECT COUNT(*) AS c FROM form_event WHERE session_id = ? AND type = 'submit'`)
        .get(sessionId) as { c: number }).c,
  );
}

function completedSubmissionCount(sessionId: string): number {
  return withDb(
    (db) =>
      (db
        .prepare(
          `SELECT COUNT(*) AS c FROM submission WHERE session_id = ? AND completed_at IS NOT NULL`,
        )
        .get(sessionId) as { c: number }).c,
  );
}

/**
 * Never let the QA browser hit real third parties. example.com (the pilot
 * fixture's redirect stub) is fulfilled locally so redirect outcomes can be
 * observed; every other non-localhost host is aborted (hubspot/calendly/gtm —
 * the embed ELEMENTS still render, which is what we assert on).
 */
async function blockThirdParty(page: Page): Promise<void> {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname === 'example.com') {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><head><title>redirect-stub</title></head><body><h1>redirect stub</h1></body></html>',
      });
    }
    return route.abort();
  });
}

/** The renderer stores its funnel session UUID in sessionStorage on mount. */
async function getSessionId(page: Page): Promise<string> {
  let sid = '';
  await expect
    .poll(
      async () =>
        (sid =
          (await page.evaluate((k) => window.sessionStorage.getItem(k), SESSION_KEY)) ?? ''),
      { message: 'renderer should mint a session id' },
    )
    .not.toBe('');
  return sid;
}

async function openCover(page: Page): Promise<void> {
  await blockThirdParty(page);
  // The shared QA API rate-limits the public surface per IP (60 burst, 1/sec
  // refill) and OTHER concurrent suites drain the same localhost bucket — the
  // SSR form fetch can transiently 429 and render the "didn't load" error
  // page. Back off and reload instead of failing the run.
  for (let attempt = 1; ; attempt += 1) {
    await page.goto(FORM_PATH, { waitUntil: 'domcontentloaded' });
    try {
      await expect(
        page.getByRole('heading', { name: 'Find the right plan for your team' }),
      ).toBeVisible({ timeout: 10_000 });
      break;
    } catch (err) {
      if (attempt >= 4) throw err;
      await page.waitForTimeout(3_000);
    }
  }
  // sessionStorage is only written once the client island hydrates — waiting
  // for it makes the Start click reliable (a pre-hydration click is lost).
  await getSessionId(page);
}

async function startForm(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start now' }).click();
}

/**
 * Click the flow's final button (phone `Submit`, or `Next` on the terminal
 * disqualification message) and wait until the submission lands: booking
 * screen, outcome redirect, or done screen. A transient 429 from the shared
 * rate-limited API surfaces the renderer's submit error — back off (token
 * bucket refills 1/sec) and resubmit.
 */
async function submitFinalStep(page: Page, buttonName: 'Submit' | 'Next'): Promise<void> {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await page.getByRole('button', { name: buttonName, exact: true }).click();
    let state: string | null = null;
    await expect
      .poll(
        async () => {
          if (page.url().includes('example.com')) return (state = 'redirect');
          if (await page.getByTestId('booking-screen').count()) return (state = 'booking');
          if (await page.locator('.pf-done__title').count()) return (state = 'done');
          if (await page.locator('.pf__error').count()) return (state = 'error');
          return null;
        },
        { timeout: 20_000, message: 'submission should land or surface an error' },
      )
      .not.toBeNull();
    if (state !== 'error') return;
    await page.waitForTimeout(4_000);
  }
  throw new Error('form submission kept failing — rate limiter never let it through');
}

/**
 * NOTE ordering: the runtime walks the AUTHORED `config.steps` order verbatim
 * (WYSIWYG — the P0 two-phase reorder was removed; `flowGroup` only affects
 * scoring). The imported pilot form authors the name step FIRST, so it walks
 * name → problema → slider → industry → uso_ia → email → (website) →
 * (disqualified) → phone — the pilot's original config order.
 */
async function answerName(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: /what.s your name/i })).toBeVisible();
  await page.getByLabel('First name').fill('QA');
  await page.getByLabel('Last name').fill(`Run${RUN_ID}`);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
}

async function chooseProblem(page: Page, optionLabel: string): Promise<void> {
  // Second runtime step (the name step is authored — and therefore rendered —
  // first). Its "[firstname], …" template interpolates the just-captured name;
  // the substring match tolerates the interpolated prefix.
  await expect(
    page.getByRole('heading', { name: /what problem are you solving/i }),
  ).toBeVisible({ timeout: 10_000 });
  await page.getByRole('radio', { name: optionLabel }).click(); // auto-advances
}

async function answerEmail(page: Page, email: string): Promise<void> {
  await expect(page.getByRole('heading', { name: /work email/i })).toBeVisible();
  await page.locator('input[type="email"]').fill(email);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
}

async function expectRevealPlays(page: Page): Promise<void> {
  await expect(page.locator('.pf-reveal__headline')).toHaveText(/Finding your best match/, {
    timeout: 8_000,
  });
}

/**
 * Qualified walk (authored order): name → problema "Cold leads follow-up" →
 * slider (default 100) → industry Banking → uso_ia production → email →
 * reveal → phone. Leaves the page right after submitting the phone (last) step.
 */
async function walkQualified(page: Page, email: string): Promise<string> {
  await openCover(page);
  const sessionId = await getSessionId(page);
  await startForm(page);

  await answerName(page);
  await chooseProblem(page, 'Cold leads follow-up');

  // Slider shows the problema-specific question VARIANT and seeds its default (100).
  await expect(
    page.getByRole('heading', { name: /how many cold leads do you get per month/i }),
  ).toBeVisible();
  await expect(page.locator('input[type="range"]')).toHaveValue('100');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // Industry is a searchable dropdown; selecting auto-advances.
  await expect(page.getByRole('heading', { name: /what industry are you in/i })).toBeVisible();
  await page.getByRole('combobox').click();
  await page.locator('.pf-dropdown__option', { hasText: 'Banking' }).click();

  await expect(page.getByRole('heading', { name: /are you using ai today/i })).toBeVisible();
  await page.getByRole('radio', { name: 'Yes, in production' }).click();

  await answerEmail(page, email);
  await expectRevealPlays(page);

  // After the reveal: phone is next. Corporate email ⇒ website step must NOT appear.
  await expect(page.getByRole('heading', { name: /phone number/i })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole('heading', { name: /company website/i })).toHaveCount(0);

  await page.locator('input[type="tel"]').fill('3001234567');
  await submitFinalStep(page, 'Submit');
  return sessionId;
}

/** Wait for any accepted end-of-form booking signal (embed testids or redirect stub). */
async function expectBookingOrRedirect(page: Page): Promise<string> {
  let signal: string | null = null;
  await expect
    .poll(
      async () => {
        if (page.url().includes('example.com')) return (signal = 'redirect');
        if (await page.getByTestId('booking-iframe-hubspot').count()) return (signal = 'hubspot');
        if (await page.getByTestId('booking-embed-calendly').count())
          return (signal = 'calendly');
        return null;
      },
      { timeout: 15_000, message: 'expected a booking embed or an outcome redirect' },
    )
    .not.toBeNull();
  return signal!;
}

// Completed sessions from this run whose funnel stream test 5 audits.
const completedSessions: { label: string; sessionId: string }[] = [];

test('pilot form renders its cover and starts', async ({ page }) => {
  await openCover(page);
  await expect(page.getByText('Book a call and get a free onboarding session')).toBeVisible(); // banner
  await expect(page.getByText('2-minute assessment')).toBeVisible(); // badge
  await startForm(page);
  // First step (name — the pilot authors it first, and authored order is
  // authoritative) + progress chrome.
  await expect(page.getByRole('heading', { name: /what.s your name/i })).toBeVisible();
  await expect(page.locator('.pf__topbar')).toBeVisible();
});

test('qualified lead: variants, reveal, and a booking screen', async ({ page }) => {
  test.setTimeout(90_000); // headroom for rate-limit backoffs on the shared QA API
  const sessionId = await walkQualified(page, 'qa@acmecorp.com');

  const signal = await expectBookingOrRedirect(page);
  expect(['hubspot', 'calendly', 'redirect']).toContain(signal);

  // Deterministic for this frozen config: score 4 ⇒ P2 ⇒ hubspot_meetings embed.
  if (signal === 'hubspot') {
    await expect(page.getByTestId('booking-screen')).toBeVisible();
    await expect(page.getByTestId('booking-iframe-hubspot')).toHaveAttribute(
      'src',
      /meetings\.hubspot\.com/,
    );
  }

  // The completed submission is persisted exactly once for this session.
  await expect.poll(() => completedSubmissionCount(sessionId), { timeout: 10_000 }).toBe(1);
  completedSessions.push({ label: 'qualified', sessionId });
});

test('disqualified lead: terminal message, ends without booking', async ({ page }) => {
  test.setTimeout(90_000);
  await openCover(page);
  const sessionId = await getSessionId(page);
  await startForm(page);

  await answerName(page);
  await chooseProblem(page, 'None of these');

  // Slider + industry are skipped for "ninguna" — uso_ia is the next question.
  await expect(page.getByRole('heading', { name: /are you using ai today/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /leads.*per month/i })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Not yet' }).click();

  await answerEmail(page, 'qa-dq@acmecorp.com');
  await expectRevealPlays(page);

  // Disqualification message step appears — and it is terminal: continuing
  // finalizes to the P0 redirect (no booking screen ever mounts).
  await expect(
    page.getByRole('heading', { name: /we can.t help you just yet/i }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('booking-screen')).toHaveCount(0);
  await submitFinalStep(page, 'Next');

  await page.waitForURL(/example\.com\/typ-p0/, { timeout: 15_000 });
  await expect(page.getByTestId('booking-screen')).toHaveCount(0);

  // Terminal path still persists exactly one COMPLETED submission (no phone step).
  await expect.poll(() => completedSubmissionCount(sessionId), { timeout: 10_000 }).toBe(1);
  completedSessions.push({ label: 'disqualified', sessionId });
});

test('personal email inserts the website step before phone', async ({ page }) => {
  test.setTimeout(90_000);
  await openCover(page);
  await startForm(page);

  await answerName(page);
  await chooseProblem(page, 'Cold leads follow-up');

  await expect(
    page.getByRole('heading', { name: /how many cold leads do you get per month/i }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  await page.getByRole('combobox').click();
  await page.locator('.pf-dropdown__option', { hasText: 'Software' }).click();
  await page.getByRole('radio', { name: 'Experimenting' }).click();

  await answerEmail(page, 'test@gmail.com');
  await expectRevealPlays(page);

  // Personal email ⇒ the website step appears BEFORE phone…
  await expect(page.getByRole('heading', { name: /company website/i })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole('heading', { name: /phone number/i })).toHaveCount(0);

  // …and phone follows right after it.
  await page.locator('input[type="text"]').fill('https://acme-qa.example');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: /phone number/i })).toBeVisible();
});

test('funnel events: exactly one submit per completed session', async ({ page }) => {
  test.setTimeout(120_000);

  // Standalone safety net (e.g. isolated retry loses the collected sessions):
  // complete one qualified walk of our own.
  if (completedSessions.length === 0) {
    const sessionId = await walkQualified(page, 'qa-events@acmecorp.com');
    await expectBookingOrRedirect(page);
    completedSessions.push({ label: 'events-own-walk', sessionId });
  }

  // Every completed session from this run recorded its submit funnel event…
  for (const { label, sessionId } of completedSessions) {
    await expect
      .poll(() => submitEventCount(sessionId), {
        timeout: 10_000,
        message: `submit event missing for ${label} session ${sessionId}`,
      })
      .toBe(1);
  }

  // …and never double-fires it (the pilot's client+server double-count bug):
  // give any straggler write a moment, then re-assert the count is STILL 1.
  await page.waitForTimeout(2_000);
  for (const { label, sessionId } of completedSessions) {
    expect(submitEventCount(sessionId), `duplicate submit event for ${label}`).toBe(1);
    expect(
      completedSubmissionCount(sessionId),
      `expected exactly one completed submission for ${label}`,
    ).toBe(1);
  }
});
