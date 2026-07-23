import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * V2 — partial submissions genuinely persist and upgrade.
 *
 * Form under test: an email step (the partial threshold) + two follow-up steps,
 * with `partialSubmitAfterStep: 1` so a PARTIAL fires the moment the first step
 * is completed. Four facts are proven:
 *
 *   1. (browser) Answer past the threshold then ABANDON the form before finishing
 *      → a durable `submission` row exists for that session with `partial_at`
 *      set and `completed_at` still null. Abandonment never fabricates a
 *      completion.
 *   2. (browser) Complete the WHOLE form end-to-end → the same row lands with
 *      `completed_at` set and every answer persisted.
 *   3. (API) Upgrade path: POST {partial:true} then {partial:false} on one
 *      session → the SAME row id, `partial_at` RETAINED (COALESCE keeps the
 *      original), `completed_at` now set, answers upgraded.
 *   4. (API) Reorder guard: complete first, then a late, out-of-order
 *      {partial:true} on that session → the finalized `completed_at`, answers,
 *      and score are frozen — a straggling partial cannot clobber a completion.
 *
 * The upgrade + reorder cases run at the API for determinism (a fire-and-forget
 * browser partial can race the complete submit; here we sequence them exactly).
 *
 * Invariants respected: the QA server is already running (never booted/killed);
 * the DB is only ever written through the app's HTTP API and only ever READ via
 * readonly better-sqlite3 connections; the admin account is resolved from
 * GET /v1/me (never hardcoded `acme`); each test mints its own uniquely-named
 * form so reruns stay idempotent.
 */

const API = 'http://localhost:4400';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// better-sqlite3 is not hoisted to the workspace root (pnpm keeps it under
// packages/db) — resolve it through the package that depends on it. Readonly
// connections only: this spec NEVER writes qa.db except through the running app.
const requireFromDb = createRequire(path.join(REPO_ROOT, 'packages', 'db', 'package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Database: any = requireFromDb('better-sqlite3');
const DB_PATH = path.join(REPO_ROOT, '.data', 'qa.db');

// A per-process nonce (NOT Date.now — deliberately kept out of this spec) plus a
// per-form counter make every form name/slug distinct across reruns, so the
// suite is idempotent and never reads a previous run's rows.
const RUN = randomUUID().slice(0, 8);
let formSeq = 0;

// A per-run fake client IP isolates this spec's public API POSTs in their own
// rate-limit bucket: QA sets PUBLIC_APP_URL, so trustProxyHops=1 and the limiter
// keys on the LAST X-Forwarded-For entry — immune to the shared 127.0.0.1 bucket.
const XFF_IP = `198.51.100.${(parseInt(RUN, 16) % 250) + 1}`;
const PUBLIC_HEADERS = { 'X-Forwarded-For': XFF_IP };

// --- DB assertion helpers (readonly) ----------------------------------------

function dbGet<T>(sqlText: string, ...params: unknown[]): T | undefined {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return db.prepare(sqlText).get(...params) as T | undefined;
  } finally {
    db.close();
  }
}

type SubmissionRow = {
  id: string;
  session_id: string;
  data: string;
  score: number;
  partial_at: number | null;
  completed_at: number | null;
};

/** The single submission row for a (form, session), via a fresh readonly conn. */
function submissionFor(formId: string, sessionId: string): SubmissionRow | undefined {
  return dbGet<SubmissionRow>(
    `SELECT id, session_id, data, score, partial_at, completed_at
       FROM submission WHERE form_id = ? AND session_id = ?`,
    formId,
    sessionId,
  );
}

// --- setup helpers ----------------------------------------------------------

/** The admin principal's public account code (NOT hardcoded `acme`). */
async function accountCode(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/v1/me`);
  expect(res.ok(), 'GET /v1/me should resolve the local principal').toBeTruthy();
  const me = (await res.json()) as { accountShortCode?: string; accountCode?: string };
  const code = me.accountShortCode ?? me.accountCode;
  expect(code, '/v1/me must expose an account code').toBeTruthy();
  return code as string;
}

function buildConfig() {
  return {
    version: 1,
    cover: { enabled: true, headline: 'Partial submit QA', ctaText: 'Start' },
    steps: [
      { key: 'email', type: 'email', question: 'Your work email?', required: true },
      { key: 'firstname', type: 'text', question: 'Your first name?', required: true },
      { key: 'company', type: 'text', question: 'Your company?', required: true },
    ],
    scoring: { enabled: true },
    // 1-based over `steps`: a partial fires the instant the FIRST step (email)
    // is completed — the lead-capture threshold under test.
    partialSubmitAfterStep: 1,
    outcomes: [{ id: 'default', label: 'Thanks', minScore: -100 }],
  };
}

/** Create a fresh, immediately-live form (POST writes live config — no publish). */
async function createForm(
  request: APIRequestContext,
  label: string,
): Promise<{ id: string; slug: string }> {
  formSeq += 1;
  const name = `qa-v2-partial-${label}-${RUN}-${formSeq}`;
  const res = await request.post(`${API}/v1/forms`, { data: { name, config: buildConfig() } });
  expect(res.ok(), 'POST /v1/forms should create the form').toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string };
  expect(body.id, 'create response must carry an id').toBeTruthy();
  expect(body.slug, 'create response must carry a slug').toBeTruthy();
  return body;
}

// --- browser helpers --------------------------------------------------------

/**
 * The public surface is per-IP rate-limited and every concurrent QA spec shares
 * the browser-origin bucket; a transient 429 leaves the cover unrendered. Retry
 * the initial fetch with a refill pause, then start the flow.
 */
async function openCover(page: Page, url: string): Promise<void> {
  const start = page.getByRole('button', { name: 'Start' });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.goto(url);
    const visible = await start
      .waitFor({ state: 'visible', timeout: 4_000 })
      .then(() => true)
      .catch(() => false);
    if (visible) {
      await start.click();
      return;
    }
    await page.waitForTimeout(2_500); // let the shared token bucket refill
  }
  throw new Error('form cover never rendered (public form fetch likely rate-limited)');
}

/** The renderer's per-session id (sessionStorage) — read it before abandoning. */
function readSessionId(page: Page, code: string, slug: string): Promise<string | null> {
  return page.evaluate((key) => window.sessionStorage.getItem(key), `quill-form-${code}-${slug}`);
}

/** Fill the current step's input and click its inline Continue button. */
async function fillAndContinue(page: Page, selector: string, value: string): Promise<void> {
  const input = page.locator(selector);
  await expect(input).toBeVisible();
  await input.fill(value);
  await page.locator('.pf__btn--inline').first().click();
}

/**
 * Submit the final step and wait for the terminal done screen. A transient
 * public 429 drops the renderer back on the step with an inline retry button;
 * wait for the limiter to refill and resubmit until the thank-you paints.
 */
async function submitFinalUntilDone(page: Page): Promise<void> {
  const done = page.locator('.pf-done__title');
  const deadline = Date.now() + 25_000;
  await page.locator('.pf__btn--inline').first().click();
  while (Date.now() < deadline) {
    if (await done.isVisible().catch(() => false)) return;
    const retry = page.locator('.pf__btn--inline').first();
    if (await retry.isVisible().catch(() => false)) {
      await page.waitForTimeout(1_500); // refill, then re-submit
      await retry.click().catch(() => {});
    } else {
      await page.waitForTimeout(300); // mid-submit; let the phase settle
    }
  }
  await expect(done).toBeVisible({ timeout: 5_000 });
}

// ---------------------------------------------------------------------------

test('public form abandoned past the threshold → durable PARTIAL row (partial_at set, completed_at null)', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000); // headroom for shared-rate-limiter retries only
  const code = await accountCode(request);
  const form = await createForm(request, 'abandon');
  await openCover(page, `/${code}/me/${form.slug}`);

  // Step 1 (email) is the partial threshold. Capture the client's sessionId
  // BEFORE navigating away — the abandon nav drops sessionStorage.
  await expect(page.locator('.pf__question')).toHaveText('Your work email?');
  const sessionId = await readSessionId(page, code, form.slug);
  expect(sessionId, 'renderer must mint a sessionId').toBeTruthy();

  // Answer the email step → fires the (fire-and-forget) partial, advances to step 2.
  await fillAndContinue(page, 'input[type="email"]', `qa-partial-${RUN}@example.com`);
  await expect(page.locator('.pf__question')).toHaveText('Your first name?');

  // The partial must land as a durable row: partial_at set, completed_at null.
  // Poll here (the visitor realistically lingers on step 2) so the background
  // save completes without depending on nav timing.
  await expect
    .poll(() => submissionFor(form.id, sessionId!)?.partial_at ?? null, {
      message: 'partial submission row should persist',
      timeout: 15_000,
    })
    .not.toBeNull();
  const partial = submissionFor(form.id, sessionId!)!;
  expect(partial.completed_at, 'a partial is not completed').toBeNull();

  // ABANDON: leave the form before finishing the remaining steps.
  await page.goto('about:blank');

  // The row stays partial — walking away never fabricates a completion.
  const afterAbandon = submissionFor(form.id, sessionId!)!;
  expect(afterAbandon.id, 'same durable row').toBe(partial.id);
  expect(afterAbandon.partial_at, 'partial_at is preserved after abandonment').not.toBeNull();
  expect(afterAbandon.completed_at, 'an abandoned form must never complete').toBeNull();
});

test('public form completed end-to-end → row is COMPLETED (completed_at set, answers persisted)', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const code = await accountCode(request);
  const form = await createForm(request, 'complete');
  await openCover(page, `/${code}/me/${form.slug}`);

  await expect(page.locator('.pf__question')).toHaveText('Your work email?');
  const sessionId = await readSessionId(page, code, form.slug);
  expect(sessionId, 'renderer must mint a sessionId').toBeTruthy();

  // Drive every step to the end.
  await fillAndContinue(page, 'input[type="email"]', `qa-complete-${RUN}@example.com`);
  await expect(page.locator('.pf__question')).toHaveText('Your first name?');
  await fillAndContinue(page, 'input[type="text"]', 'Alex');
  await expect(page.locator('.pf__question')).toHaveText('Your company?');

  const company = page.locator('input[type="text"]');
  await expect(company).toBeVisible();
  await company.fill('Dapta');
  await submitFinalUntilDone(page);

  // The durable fact: a completed row carrying every answer.
  await expect
    .poll(() => submissionFor(form.id, sessionId!)?.completed_at ?? null, {
      message: 'completed submission row should exist',
      timeout: 15_000,
    })
    .not.toBeNull();
  const row = submissionFor(form.id, sessionId!)!;
  const answers = JSON.parse(row.data) as Record<string, unknown>;
  expect(answers.email).toBe(`qa-complete-${RUN}@example.com`);
  expect(answers.firstname).toBe('Alex');
  expect(answers.company).toBe('Dapta');
});

test('API upgrade: {partial:true} then {partial:false} on one session → same row, partial_at retained, completed_at set', async ({
  request,
}) => {
  const code = await accountCode(request);
  const form = await createForm(request, 'upgrade');
  const sessionId = randomUUID();
  const url = `${API}/v1/public/forms/${code}/${form.slug}/submissions`;

  // 1) Partial save.
  const p = await request.post(url, {
    headers: PUBLIC_HEADERS,
    data: { sessionId, partial: true, data: { email: `qa-upgrade-${RUN}@example.com` } },
  });
  expect(p.status()).toBe(201);
  const partialId = ((await p.json()) as { id: string }).id;

  const afterPartial = submissionFor(form.id, sessionId)!;
  expect(afterPartial, 'partial save must persist a row').toBeTruthy();
  expect(afterPartial.id).toBe(partialId);
  expect(afterPartial.partial_at, 'a partial save sets partial_at').not.toBeNull();
  expect(afterPartial.completed_at, 'a partial is not complete').toBeNull();
  const partialAt = afterPartial.partial_at;

  // 2) Complete submit on the SAME session → upgrades the SAME row in place.
  const c = await request.post(url, {
    headers: PUBLIC_HEADERS,
    data: {
      sessionId,
      partial: false,
      data: { email: `qa-upgrade-${RUN}@example.com`, firstname: 'Robin', company: 'Dapta' },
    },
  });
  expect(c.status()).toBe(201);
  const completeId = ((await c.json()) as { id: string }).id;
  expect(completeId, 'upgrading keeps the same submission id (one row per session)').toBe(partialId);

  const afterComplete = submissionFor(form.id, sessionId)!;
  expect(afterComplete.id).toBe(partialId);
  expect(afterComplete.partial_at, 'partial_at is RETAINED through the upgrade').toBe(partialAt);
  expect(afterComplete.completed_at, 'completing the upgrade sets completed_at').not.toBeNull();
  const answers = JSON.parse(afterComplete.data) as Record<string, unknown>;
  expect(answers.firstname, 'answers are upgraded to the complete payload').toBe('Robin');
  expect(answers.company).toBe('Dapta');
});

test('API reorder guard: a late {partial:true} after completion leaves completed_at + answers unchanged', async ({
  request,
}) => {
  const code = await accountCode(request);
  const form = await createForm(request, 'reorder');
  const sessionId = randomUUID();
  const url = `${API}/v1/public/forms/${code}/${form.slug}/submissions`;

  // 1) Complete first.
  const c = await request.post(url, {
    headers: PUBLIC_HEADERS,
    data: {
      sessionId,
      partial: false,
      data: { email: `qa-reorder-${RUN}@example.com`, firstname: 'Sam', company: 'Dapta' },
    },
  });
  expect(c.status()).toBe(201);
  const completeId = ((await c.json()) as { id: string }).id;

  const completed = submissionFor(form.id, sessionId)!;
  expect(completed.completed_at, 'the row is completed').not.toBeNull();
  const frozen = {
    data: completed.data,
    completedAt: completed.completed_at,
    score: completed.score,
  };

  // 2) A late, out-of-order partial (a fire-and-forget that lost the race)
  // carrying DIFFERENT answers must NOT overwrite the finalized row.
  const late = await request.post(url, {
    headers: PUBLIC_HEADERS,
    data: {
      sessionId,
      partial: true,
      data: { email: `qa-reorder-${RUN}@example.com`, firstname: 'OVERWRITE', company: 'OVERWRITE' },
    },
  });
  expect(late.status()).toBe(201);
  const lateId = ((await late.json()) as { id: string }).id;
  expect(lateId, 'the late partial resolves to the same row').toBe(completeId);

  // The reorder guard froze the completion: nothing about the row moved.
  const afterLate = submissionFor(form.id, sessionId)!;
  expect(afterLate.id).toBe(completeId);
  expect(afterLate.completed_at, 'completed_at is frozen by the reorder guard').toBe(frozen.completedAt);
  expect(afterLate.data, 'finalized answers are not clobbered by a late partial').toBe(frozen.data);
  expect(afterLate.score, 'the finalized score is preserved').toBe(frozen.score);
  const answers = JSON.parse(afterLate.data) as Record<string, unknown>;
  expect(answers.firstname).toBe('Sam');
  expect(answers.company).toBe('Dapta');
});
