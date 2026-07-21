import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * V4-13 / V4-14 / V4-15 — the "field II" batch on the public form + builder.
 *
 *  (a) V4-13 — URL-parameter prefill + hidden question. A VISIBLE text step
 *      keyed `plan` opened at `?plan=enterprise` renders pre-filled and submits
 *      "enterprise"; a HIDDEN step keyed `source` opened at `?source=ads` is
 *      never shown yet still rides its answer ("ads") into the submission. Only
 *      DECLARED field keys are read from the query string (scoped in the
 *      renderer's `capturePrefill`); the engine re-validates on submit.
 *  (b) V4-14 — per-form phone default country. A phone step with
 *      `phoneDefaultCountry: "CO"` starts the public country picker on Colombia
 *      (+57) even under the default (en) locale, which would otherwise default
 *      to US.
 *  (c) V4-15 — description interpolation + the `@` recall picker on the
 *      description. A step whose description is "Details for [firstname]" renders
 *      the interpolated helper on the public form once firstname is captured;
 *      and in the builder, typing `@` in the description opens the token picker.
 *
 * Forms are created via the admin API under unique `v4f2-` names (per-run token
 * + counter, never Date.now) so slugs never collide and DB assertions stay
 * scoped to each fresh form id. The public API is rate-limited and its bucket is
 * SHARED across suites — every public open backs off + reloads on a transient
 * miss instead of failing.
 */

const API = 'http://localhost:4400';

const specDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(specDir, '../..');
const DB_PATH = path.join(repoRoot, '.data', 'qa.db');

// better-sqlite3 is hoisted into packages/db (pnpm), not the repo root.
const dbRequire = createRequire(path.join(repoRoot, 'packages/db/package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Database: any = dbRequire('better-sqlite3');

/** Run a query on a fresh readonly connection (always sees latest commits). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function q<T>(fn: (db: any) => T): T {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const RUN = Math.random().toString(36).slice(2, 8);
let seq = 0;
function uniqueName(label: string): string {
  seq += 1;
  return `v4f2-${label}-${RUN}-${seq}`;
}

/**
 * POST /v1/forms (create writes LIVE config) → the form id (for DB assertions)
 * and the public path /<accountCode>/me/<slug>. The account code is resolved
 * from GET /v1/me — the local-stub principal is not a hardcoded account.
 */
async function createForm(
  request: APIRequestContext,
  name: string,
  config: Record<string, unknown>,
): Promise<{ id: string; formPath: string }> {
  const me = await request.get(`${API}/v1/me`);
  expect(me.ok(), `GET /v1/me failed: ${me.status()}`).toBeTruthy();
  const { accountCode } = (await me.json()) as { accountCode: string };

  const res = await request.post(`${API}/v1/forms`, { data: { name, config } });
  expect(res.ok(), `form creation failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string };
  return { id: body.id, formPath: `/${accountCode}/me/${body.slug}` };
}

/**
 * Open a public form URL (path may carry a query string) and click through the
 * cover to the first step. Backs off + reloads on a transient rate-limit miss
 * (the SSR fetch can 429 when the shared bucket is drained by other suites).
 */
async function openToFirstStep(page: Page, url: string): Promise<void> {
  await page.goto(url);
  const start = page.getByRole('button', { name: 'Start' });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const visible = await start
      .waitFor({ state: 'visible', timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    if (visible) break;
    await page.waitForTimeout(1_500);
    await page.reload();
  }
  await start.click();
}

// --- (a) URL-parameter prefill + hidden question ----------------------------

test('V4-13: a visible step prefills from ?key=…; a hidden step is never shown yet still submits its URL value', async ({
  page,
  request,
}) => {
  const config = {
    version: 1,
    cover: { enabled: true, headline: 'Prefill QA', ctaText: 'Start' },
    steps: [
      { key: 'plan', type: 'text', question: 'Which plan?', required: false },
      { key: 'source', type: 'text', question: 'Where did you hear about us?', hidden: true },
    ],
  };
  const { id, formPath } = await createForm(request, uniqueName('prefill'), config);

  await openToFirstStep(page, `${formPath}?plan=enterprise&source=ads`);

  // The VISIBLE `plan` step renders pre-filled from the query string…
  const input = page.locator('.pf-input');
  await expect(input).toHaveValue('enterprise');

  // …and the HIDDEN `source` step never renders as a question — `plan` is the
  // only visible step, so submitting it lands the done screen immediately.
  await expect(page.getByText('Where did you hear about us?')).toHaveCount(0);
  await page.locator('.pf__btn--inline').click();
  await expect(page.locator('.pf-done__title')).toBeVisible({ timeout: 15_000 });

  // Both answers persist: the visible prefill AND the hidden step's URL value.
  await expect
    .poll(
      () => {
        const row = q((db) =>
          db.prepare('SELECT completed_at FROM submission WHERE form_id = ?').get(id),
        ) as { completed_at: number | null } | undefined;
        return row?.completed_at ? 'completed' : 'waiting';
      },
      { timeout: 10_000, message: 'submission never completed for the prefill form' },
    )
    .toBe('completed');

  const row = q((db) =>
    db.prepare('SELECT data FROM submission WHERE form_id = ?').get(id),
  ) as { data: string };
  const data = JSON.parse(row.data) as Record<string, unknown>;
  expect(data.plan).toBe('enterprise');
  expect(data.source).toBe('ads'); // hidden field carried into the submission
});

test('V4-13: an undeclared query key is NOT seeded (prefill is scoped to declared fields)', async ({
  page,
  request,
}) => {
  const config = {
    version: 1,
    cover: { enabled: true, headline: 'Scoped prefill QA', ctaText: 'Start' },
    steps: [{ key: 'plan', type: 'text', question: 'Which plan?', required: true }],
  };
  const { id, formPath } = await createForm(request, uniqueName('scoped'), config);

  // `evil` matches no declared field → ignored; `plan` is declared → seeded.
  await openToFirstStep(page, `${formPath}?plan=pro&evil=INJECTED`);
  await expect(page.locator('.pf-input')).toHaveValue('pro');
  await page.locator('.pf__btn--inline').click();
  await expect(page.locator('.pf-done__title')).toBeVisible({ timeout: 15_000 });

  await expect
    .poll(
      () => {
        const row = q((db) =>
          db.prepare('SELECT completed_at FROM submission WHERE form_id = ?').get(id),
        ) as { completed_at: number | null } | undefined;
        return row?.completed_at ? 'done' : 'waiting';
      },
      { timeout: 10_000 },
    )
    .toBe('done');

  const row = q((db) =>
    db.prepare('SELECT data FROM submission WHERE form_id = ?').get(id),
  ) as { data: string };
  const data = JSON.parse(row.data) as Record<string, unknown>;
  expect(data.plan).toBe('pro');
  expect('evil' in data).toBe(false); // never seeded from an arbitrary query key
});

// --- (b) per-form phone default country --------------------------------------

test('V4-14: phoneDefaultCountry "CO" starts the public phone picker on Colombia (+57)', async ({
  page,
  request,
}) => {
  const config = {
    version: 1,
    cover: { enabled: true, headline: 'Phone default QA', ctaText: 'Start' },
    steps: [
      { key: 'phone', type: 'phone', question: 'Your phone?', required: true, phoneDefaultCountry: 'CO' },
    ],
  };
  const { formPath } = await createForm(request, uniqueName('phone-co'), config);

  // Default (en) locale would normally pick US (+1); the per-form default wins.
  await openToFirstStep(page, formPath);
  await expect(page.locator('.pf-phone')).toBeVisible();
  await expect(page.locator('.pf-phone__dial')).toHaveText('+57');
});

// --- (c) description interpolation (public) + @ picker (editor) ---------------

test('V4-15: a description with [firstname] interpolates on the public form after the name step', async ({
  page,
  request,
}) => {
  const config = {
    version: 1,
    cover: { enabled: true, headline: 'Desc interp QA', ctaText: 'Start' },
    steps: [
      { key: 'fullname', type: 'name', question: "What's your name?", required: false, fields: ['firstname', 'lastname'] },
      { key: 'topic', type: 'text', question: 'Tell us more', helper: 'Details for [firstname]' },
    ],
  };
  const { formPath } = await createForm(request, uniqueName('desc-interp'), config);

  await openToFirstStep(page, formPath);

  // Capture the first name on the name step, then advance.
  await expect(page.getByRole('heading', { name: /what.s your name/i })).toBeVisible();
  await page.getByLabel('First name').fill('Sam');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // The next step's description interpolates the just-captured firstname.
  await expect(page.locator('.pf__question')).toHaveText('Tell us more');
  await expect(page.locator('.pf__helper')).toHaveText('Details for Sam');
});

test('V4-15: typing @ in the builder description opens the token picker (fields captured before the step)', async ({
  page,
  request,
}) => {
  const config = {
    version: 1,
    cover: { enabled: true, headline: 'Desc picker QA', ctaText: 'Start' },
    steps: [
      { key: 'fullname', type: 'name', question: "What's your name?", required: false, fields: ['firstname', 'lastname'] },
      { key: 'topic', type: 'text', question: 'Tell us more' },
    ],
  };
  const { id } = await createForm(request, uniqueName('desc-picker'), config);

  await page.goto(`/admin/forms/${id}/edit`);
  // q1 (name) is auto-selected; switch to q2 (the text step) via its spine row.
  await expect(page.getByTestId('canvas-title-input')).toHaveValue("What's your name?");
  await page.getByRole('button', { name: 'Tell us more' }).first().click();
  await expect(page.getByTestId('canvas-title-input')).toHaveValue('Tell us more');

  // Typing `@` in the description opens the picker listing the earlier name
  // subfields, and Enter inserts the engine token.
  const description = page.getByTestId('canvas-description-input');
  await description.click();
  await description.pressSequentially('@');
  await expect(page.getByTestId('token-picker')).toBeVisible();
  const options = page.getByTestId('token-option');
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toHaveAttribute('data-key', 'firstname');
  await page.keyboard.press('Enter');
  await expect(description).toHaveValue('[firstname]');
});
