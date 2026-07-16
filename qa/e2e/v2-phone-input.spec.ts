import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * V2 — country-code phone input on the public form
 * (apps/web/components/public/phone-input.tsx, rendered by step-input.tsx's
 * `phone` case).
 *
 * The `phone` step is NOT a bare <input type="tel"> — it is a `.pf-phone`
 * composite: a country-picker trigger (flag + dial code like "+1"/"+52") that
 * opens a searchable `.pf-phone__panel` listbox of countries, beside a
 * digits-only number input. The stored answer is a single E.164 string
 * (`+<dial><subscriber-digits>`), and the default country comes from the form
 * locale (en → US/+1, es → MX/+52).
 *
 * Covers:
 *  1. Structure — the step renders the country trigger (a dial code) AND a
 *     digits input, never a lone tel input.
 *  2. Country picker — clicking the trigger opens a searchable listbox; typing
 *     "mexico" surfaces the Mexico (+52) option; selecting it flips the trigger
 *     to +52.
 *  3. Capture + persistence — digits typed into the number field are captured
 *     and, on submit, persisted as an E.164 phone answer that starts with "+"
 *     and carries the dial code (asserted on the submission row in qa.db).
 *  4. Default country — with the default (en) locale the trigger defaults to
 *     +1 (US).
 *
 * Each test creates its own form via the admin API under a unique name (a
 * per-run token + counter, never Date.now) so slugs don't collide and every DB
 * assertion is scoped to that form's id — reruns stay idempotent.
 */

const API = 'http://localhost:4400';

const specDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(specDir, '../..');
const DB_PATH = path.join(repoRoot, '.data', 'qa.db');

// better-sqlite3 is hoisted into packages/db (pnpm), not the repo root — resolve
// it from there. READONLY connections only (never mutate the QA DB).
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

// Unique names without Date.now: a per-process random token + a monotonic
// counter. Slugs are derived from the name, so uniqueness prevents collisions
// across reruns while DB assertions stay scoped to each fresh form id.
const RUN = Math.random().toString(36).slice(2, 8);
let seq = 0;
function uniqueName(label: string): string {
  seq += 1;
  return `v2-phone-${label}-${RUN}-${seq}`;
}

const PHONE_KEY = 'phone';
const PHONE_QUESTION = 'Your phone number?';

/** Single required phone step behind a cover. No outcomes/reveal — bare submit. */
function phoneConfig() {
  return {
    version: 1,
    cover: { enabled: true, headline: 'Phone QA', ctaText: 'Start' },
    steps: [{ key: PHONE_KEY, type: 'phone', question: PHONE_QUESTION, required: true }],
  };
}

/**
 * POST /v1/forms (create writes LIVE config) → returns the form id (for DB
 * assertions) and the public path /<accountCode>/me/<slug>. The account code is
 * resolved from GET /v1/me — the local-stub principal is not a hardcoded
 * account.
 */
async function createPhoneForm(
  request: APIRequestContext,
  name: string,
): Promise<{ id: string; path: string }> {
  const me = await request.get(`${API}/v1/me`);
  expect(me.ok(), `GET /v1/me failed: ${me.status()}`).toBeTruthy();
  const { accountCode } = (await me.json()) as { accountCode: string };

  const res = await request.post(`${API}/v1/forms`, { data: { name, config: phoneConfig() } });
  expect(res.ok(), `form creation failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string };
  return { id: body.id, path: `/${accountCode}/me/${body.slug}` };
}

/**
 * Open the public form and click through the cover to the phone step.
 *
 * The public API is rate-limited per IP and the bucket is SHARED by every QA
 * spec — a drained bucket makes the server component render not-found. Reload
 * (tokens refill ~1/s) until the cover appears instead of failing on a
 * transient 429.
 */
async function openToPhoneStep(page: Page, formPath: string): Promise<void> {
  await page.goto(formPath);
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
  await expect(page.locator('.pf__question')).toHaveText(PHONE_QUESTION);
  await expect(page.locator('.pf-phone')).toBeVisible();
}

test('phone step renders a country-code trigger plus a digits input (not a bare tel input)', async ({
  page,
  request,
}) => {
  const { path: formPath } = await createPhoneForm(request, uniqueName('structure'));
  await openToPhoneStep(page, formPath);

  // The composite widget: a country trigger (combobox) and a digits input, both
  // inside the same .pf-phone root.
  const root = page.locator('.pf-phone');
  const trigger = root.locator('.pf-phone__country');
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
  // The trigger surfaces a dial code (+1, +52, …), not just a flag.
  await expect(root.locator('.pf-phone__dial')).toHaveText(/^\+\d+$/);

  const number = root.locator('.pf-phone__number');
  await expect(number).toBeVisible();
  await expect(number).toHaveAttribute('type', 'tel');

  // Guard against a regression back to a lone <input type="tel">: every tel
  // input on the page belongs to the phone widget, and the widget always pairs
  // it with a country-picker trigger.
  await expect(page.locator('.pf-phone [aria-haspopup="listbox"]')).toHaveCount(1);
  await expect(page.locator('.pf-phone input[type="tel"]')).toHaveCount(1);
  await expect(page.locator('input[type="tel"]:not(.pf-phone__number)')).toHaveCount(0);
});

test('country picker opens a searchable listbox; searching "mexico" selects +52', async ({
  page,
  request,
}) => {
  const { path: formPath } = await createPhoneForm(request, uniqueName('picker'));
  await openToPhoneStep(page, formPath);

  const root = page.locator('.pf-phone');
  // Clicking the trigger opens the panel: a search box + a role=listbox.
  await root.locator('.pf-phone__country').click();
  await expect(root.locator('.pf-phone__panel')).toBeVisible();
  await expect(root.getByRole('listbox')).toBeVisible();
  const search = root.locator('.pf-phone__search');
  await expect(search).toBeVisible();

  // Typing a country NAME (not a dial) filters to Mexico, which carries +52.
  await search.fill('mexico');
  const mxOption = root.locator('.pf-phone__option', { hasText: '+52' });
  await expect(mxOption).toHaveCount(1);
  await expect(mxOption).toBeVisible();
  await expect(mxOption).toContainText(/mexico/i);

  // Selecting it closes the panel and flips the trigger's dial to +52.
  await mxOption.click();
  await expect(root.locator('.pf-phone__panel')).toHaveCount(0);
  await expect(root.locator('.pf-phone__dial')).toHaveText('+52');
});

test('typed digits are captured and persisted as an E.164 phone answer starting with "+"', async ({
  page,
  request,
}) => {
  const { id, path: formPath } = await createPhoneForm(request, uniqueName('persist'));
  await openToPhoneStep(page, formPath);

  const number = page.locator('.pf-phone__number');
  // Default country is US (+1); a 10-digit NANP subscriber number.
  await number.fill('5105551234');
  // The value is captured (and grouped for display) in the field.
  await expect(number).toHaveValue(/510/);

  // Submit the (single, last) step → done screen.
  await page.locator('.pf__btn--inline').click();
  await expect(page.locator('.pf-done__title')).toBeVisible({ timeout: 15_000 });

  // The submission row persists the answer as bare E.164 under the step key.
  await expect
    .poll(
      () => {
        const row = q((db) =>
          db.prepare('SELECT completed_at FROM submission WHERE form_id = ?').get(id),
        ) as { completed_at: number | null } | undefined;
        return row?.completed_at ? 'completed' : 'waiting';
      },
      { timeout: 10_000, message: 'submission row never completed for the phone form' },
    )
    .toBe('completed');

  const row = q((db) =>
    db.prepare('SELECT data FROM submission WHERE form_id = ?').get(id),
  ) as { data: string };
  const data = JSON.parse(row.data) as Record<string, unknown>;
  const phone = String(data[PHONE_KEY] ?? '');

  // E.164: starts with '+', carries the dial code (+1, US default), and the
  // subscriber digits that were typed.
  expect(phone.startsWith('+'), `phone answer "${phone}" should start with "+"`).toBeTruthy();
  expect(phone.startsWith('+1'), `phone answer "${phone}" should carry the +1 dial code`).toBeTruthy();
  expect(phone).toBe('+15105551234');
});

test('default (en) locale defaults the country trigger to +1 (US)', async ({ page, request }) => {
  const { path: formPath } = await createPhoneForm(request, uniqueName('default'));
  // No ?lang → default locale (en) → US.
  await openToPhoneStep(page, formPath);
  await expect(page.locator('.pf-phone__dial')).toHaveText('+1');
});
