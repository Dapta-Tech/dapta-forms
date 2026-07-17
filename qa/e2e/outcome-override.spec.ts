import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Answer-forced outcome overrides.
 *
 * Form under test: one scored slider (`leads`, 0–100, default 50) + an email
 * step. Outcomes:
 *   - p1: minScore 5  → redirect https://example.com/p1
 *   - p0: minScore -100 → redirect https://example.com/p0,
 *         overrides: [{ field: 'leads', maxValue: 0 }]
 *
 * Slider scoring gives +5 for 50–100 AND (deliberately) +8 for exactly 0, so a
 * slider at 0 still scores ABOVE p1's minScore — the only way the visitor can
 * land on p0 is the answer-forced override. That makes test 2 a sharp check
 * that overrides beat the score buckets, not just a re-derivation of the score.
 *
 * example.com is routed to a local stub so the outcome redirects are
 * observable without any real network egress.
 */

const API = 'http://localhost:4400';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// better-sqlite3 is not hoisted to the workspace root (pnpm); resolve it from
// packages/db, which depends on it. Readonly connections only — never write.
const requireFromDb = createRequire(path.join(REPO_ROOT, 'packages', 'db', 'package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Database: any = requireFromDb('better-sqlite3');

function buildConfig() {
  return {
    version: 1,
    cover: { enabled: true, headline: 'Outcome override QA', ctaText: 'Start' },
    steps: [
      {
        key: 'leads',
        type: 'slider',
        question: 'How many leads per month?',
        min: 0,
        max: 100,
        default: 50,
        // First matching range wins: 50–100 → +5 (clears p1); exactly 0 → +8
        // (ALSO clears p1 on score, so only the override can force p0).
        sliderScoring: [
          { min: 50, max: 100, points: 5 },
          { min: 0, max: 0, points: 8 },
        ],
        flowGroup: 'qualification',
      },
      { key: 'email', type: 'email', question: 'Your work email?', required: true },
    ],
    scoring: { enabled: true },
    outcomes: [
      { id: 'p1', label: 'P1', minScore: 5, redirectUrl: 'https://example.com/p1' },
      {
        id: 'p0',
        label: 'P0',
        minScore: -100,
        redirectUrl: 'https://example.com/p0',
        overrides: [{ field: 'leads', maxValue: 0 }],
      },
    ],
  };
}

/** Create a fresh form for this run via the admin API (config is live on create). */
async function createForm(request: APIRequestContext): Promise<{ id: string; url: string }> {
  const meRes = await request.get(`${API}/v1/me`);
  expect(meRes.ok(), 'admin /v1/me should resolve the local principal').toBeTruthy();
  const me = (await meRes.json()) as { accountCode: string };

  const name = `qa-outcome-override-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const res = await request.post(`${API}/v1/forms`, { data: { name, config: buildConfig() } });
  expect(res.ok(), 'POST /v1/forms should create the form').toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string };
  return { id: body.id, url: `/${me.accountCode}/me/${body.slug}` };
}

/** Serve example.com from a local stub so outcome redirects never leave the box. */
async function stubExampleDotCom(page: Page): Promise<void> {
  await page.route('https://example.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<main data-qa="redirect-stub">stub:${new URL(route.request().url()).pathname}</main>`,
    }),
  );
}

/**
 * The QA API rate-limits the public surface per IP, and every concurrently
 * running QA spec shares the same bucket (all traffic proxies through the Next
 * server at 127.0.0.1) — so any public request here can transiently 429.
 * Cover load and the final submit therefore retry with a refill pause.
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

/** Set the range input via keyboard (Home = jump to min) and verify the pill. */
async function setSliderToZero(page: Page): Promise<void> {
  const slider = page.locator('input[type="range"]');
  await expect(slider).toBeVisible();
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(page.locator('.pf-slider__pill-num')).toHaveText('0');
}

async function continueStep(page: Page): Promise<void> {
  await page.locator('.pf__btn--inline').first().click();
}

/**
 * Fill the last (email) step, submit, and wait for the outcome redirect. A 429
 * on the submission keeps the renderer on the step with an error alert — in
 * that case wait for the limiter to refill and submit again.
 */
async function finishAndAwaitRedirect(page: Page, targetPath: '/p1' | '/p0'): Promise<void> {
  const email = page.locator('input[type="email"]');
  await expect(email).toBeVisible();
  await email.fill('qa-override@example.com');

  const target = `https://example.com${targetPath}`;
  const deadline = Date.now() + 25_000;
  await continueStep(page);
  for (;;) {
    const redirected = await page
      .waitForURL(target, { timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (redirected) break;
    if (Date.now() > deadline)
      throw new Error(`never redirected to ${target} (submission likely rate-limited)`);
    const retryBtn = page.locator('.pf__btn--inline').first();
    if (await retryBtn.isVisible().catch(() => false)) {
      await page.waitForTimeout(2_500); // refill, then re-submit
      await retryBtn.click();
    }
  }
  await expect(page.locator('[data-qa="redirect-stub"]')).toHaveText(`stub:${targetPath}`);
}

function dbGet<T>(sql: string, ...params: unknown[]): T | undefined {
  const db = new Database(path.join(REPO_ROOT, '.data', 'qa.db'), { readonly: true });
  try {
    return db.prepare(sql).get(...params) as T | undefined;
  } finally {
    db.close();
  }
}

test('slider left high (default 50) → score wins → redirected to /p1', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000); // headroom for shared-rate-limiter retries only
  const form = await createForm(request);
  await stubExampleDotCom(page);
  await openCover(page, form.url);

  // Untouched slider keeps its seeded default of 50 (inside the +5 band).
  await expect(page.locator('input[type="range"]')).toBeVisible();
  await expect(page.locator('.pf-slider__pill-num')).toHaveText('50');
  await continueStep(page);

  await finishAndAwaitRedirect(page, '/p1');
});

test('slider set to 0 → override beats a p1-clearing score → redirected to /p0', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const form = await createForm(request);
  await stubExampleDotCom(page);
  await openCover(page, form.url);

  // 0 scores +8 (above p1's minScore of 5) — only the answer-forced override
  // rule {field: leads, maxValue: 0} can send the visitor to p0.
  await setSliderToZero(page);
  await continueStep(page);

  await finishAndAwaitRedirect(page, '/p0');
});

test('server agrees: submission data + score persisted, exactly one submit event', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const form = await createForm(request);
  await stubExampleDotCom(page);
  await openCover(page, form.url);

  await setSliderToZero(page);
  await continueStep(page);
  await finishAndAwaitRedirect(page, '/p0');

  // Completed submission row with the answers and the server-recomputed score
  // (0 hits the {0,0,+8} band). The submit is awaited before the redirect, so
  // the row is durable; poll anyway to stay tolerant of commit timing.
  type SubmissionRow = {
    session_id: string;
    data: string;
    score: number;
    completed_at: number | null;
  };
  let submission: SubmissionRow | undefined;
  await expect
    .poll(
      () => {
        submission = dbGet<SubmissionRow>(
          `SELECT session_id, data, score, completed_at FROM submission WHERE form_id = ?`,
          form.id,
        );
        return submission?.completed_at ?? null;
      },
      { message: 'completed submission row should exist', timeout: 15_000 },
    )
    .not.toBeNull();

  const answers = JSON.parse(submission!.data) as Record<string, unknown>;
  expect(answers.leads).toBe(0);
  expect(answers.email).toBe('qa-override@example.com');
  expect(submission!.score).toBe(8);

  // The funnel must record exactly ONE `submit` event for this session (the
  // pilot double-fired client+server — Forms must never regress into that).
  // The client fires it fire-and-forget just before the redirect, so poll.
  await expect
    .poll(
      () =>
        dbGet<{ n: number }>(
          `SELECT COUNT(*) AS n FROM form_event WHERE form_id = ? AND type = 'submit'`,
          form.id,
        )?.n ?? 0,
      { message: 'exactly one submit funnel event should land', timeout: 15_000 },
    )
    .toBe(1);

  const submitEvent = dbGet<{ session_id: string }>(
    `SELECT session_id FROM form_event WHERE form_id = ? AND type = 'submit'`,
    form.id,
  );
  expect(submitEvent?.session_id).toBe(submission!.session_id);

  // And it stays exactly one — no delayed server-side duplicate.
  const finalCount = dbGet<{ n: number }>(
    `SELECT COUNT(*) AS n FROM form_event WHERE form_id = ? AND type = 'submit'`,
    form.id,
  );
  expect(finalCount?.n).toBe(1);
});
