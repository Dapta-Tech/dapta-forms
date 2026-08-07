import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * V4-07 / V4-08 — conditional-visibility OPERATORS by field type, and the
 * contradiction guard.
 *
 * Two loops prove the feature end to end:
 *   1. (public runtime) A slider question gates a later question with a NUMERIC
 *      operator (`show when score > 50`). Set the slider to 60 → the gated
 *      question appears; set it to 40 → it is skipped and the next always-on
 *      question is reached. This exercises the engine's new `gt` op on the exact
 *      client path the renderer walks (`runtimeSteps` → `visibleSteps`).
 *   2. (editor) In the Visibility panel, referencing a slider field reveals the
 *      operator dropdown with the numeric comparison set (equal/greater/less/
 *      between) — the V4-07 UI. Setting Show and Hide to the SAME field + value
 *      trips the V4-08 contradiction guard: a prominent inline warning
 *      (`logic-contradiction`) that clears once the overlap is removed.
 *
 * Conventions (mirroring the V3 specs): a fresh form per test via the admin API
 * with a `v4logic-` slug prefix (per-run nonce + counter — never `Date.now`);
 * accountCode resolved from GET /v1/me (never hardcoded); the public cover is
 * retried past the shared per-IP rate-limit bucket.
 */

const API = 'http://localhost:4400';

/** Per-run nonce so reruns mint distinct forms (Date.now is banned in specs). */
const RUN = randomUUID().slice(0, 8);
let seq = 0;
function uniqueName(label: string): string {
  seq += 1;
  return `v4logic-${label}-${RUN}-${seq}`;
}

/** The admin principal's public account code (NOT hardcoded). */
async function accountCode(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/v1/me`);
  expect(res.ok(), `GET /v1/me failed: ${res.status()}`).toBeTruthy();
  const me = (await res.json()) as { accountCode: string };
  expect(me.accountCode, '/v1/me must expose an account code').toBeTruthy();
  return me.accountCode;
}

/** POST /v1/forms (create writes LIVE config) → the form id + public path. */
async function createForm(
  request: APIRequestContext,
  name: string,
  config: unknown,
): Promise<{ id: string; path: string }> {
  const code = await accountCode(request);
  const res = await request.post(`${API}/v1/forms`, { data: { name, config } });
  expect(res.ok(), `create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string };
  return { id: body.id, path: `/${code}/me/${body.slug}` };
}

/**
 * Public: a slider `score` gates `why` with a NUMERIC operator (> 50); an
 * always-on `email` follows so a hidden `why` still lands on a concrete next
 * question (a crisp positive assertion in both branches).
 */
function publicConfig() {
  return {
    version: 1,
    cover: { enabled: true, headline: 'V4 logic ops', ctaText: 'Start' },
    steps: [
      { key: 'score', type: 'slider', question: 'Rate it', min: 0, max: 100, default: 50 },
      {
        key: 'why',
        type: 'text',
        question: 'Why so high?',
        showWhen: { field: 'score', op: 'gt', value: 50 },
      },
      { key: 'email', type: 'email', question: 'Your email?', required: true },
    ],
  };
}

/** A slider `score` + a text `reason` — `reason` carries the show/hide rules. */
function editorConfig() {
  return {
    version: 1,
    steps: [
      { key: 'score', type: 'slider', question: 'Rate it', min: 0, max: 100, default: 50 },
      { key: 'reason', type: 'text', question: 'Reason?' },
    ],
  };
}

/** Open the public form and click through the cover to the first question,
 *  retrying the cover past the shared per-IP rate-limit bucket (~1 token/s). */
async function openToFirstQuestion(page: Page, formPath: string) {
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
  await expect(page.locator('.pf__question')).toHaveText('Rate it');
}

/**
 * Set the range slider to an exact value. Playwright cannot `fill` a range
 * input, so set the value through the React-compatible native setter and fire
 * `input`/`change` — the pill assertion proves React's onChange ran.
 */
async function setSlider(page: Page, value: number) {
  const slider = page.locator('input[type="range"]');
  await expect(slider).toBeVisible();
  await slider.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, String(v));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await expect(page.locator('.pf-slider__pill-num')).toHaveText(String(value));
}

/** Open a branded Select (a `button[aria-haspopup=listbox]`) by its accessible
 *  name and click one of its options (scoped to that Select's listbox). */
async function pickFromSelect(page: Page, name: string, optionName: string) {
  const trigger = page.getByRole('button', { name });
  await trigger.scrollIntoViewIfNeeded();
  const listbox = page.getByRole('listbox', { name });
  for (let i = 0; i < 4; i += 1) {
    await trigger.click();
    if (await listbox.isVisible().catch(() => false)) break;
    await page.waitForTimeout(200);
  }
  await listbox.getByRole('option', { name: optionName, exact: true }).click();
}

test.describe('V4-07 — numeric operators drive conditional visibility (public form)', () => {
  test('slider value 60 (> 50) SHOWS the gated question', async ({ page, request }) => {
    const { path } = await createForm(request, uniqueName('show'), publicConfig());
    await openToFirstQuestion(page, path);

    await setSlider(page, 60);
    await page.locator('.pf__btn--inline').first().click();

    // score 60 > 50 → the `why` branch is visible.
    await expect(page.locator('.pf__question')).toHaveText('Why so high?');
  });

  test('slider value 40 (≤ 50) HIDES the gated question', async ({ page, request }) => {
    const { path } = await createForm(request, uniqueName('hide'), publicConfig());
    await openToFirstQuestion(page, path);

    await setSlider(page, 40);
    await page.locator('.pf__btn--inline').first().click();

    // score 40 ≤ 50 → `why` is skipped; the next visible question is `email`.
    await expect(page.locator('.pf__question')).toHaveText('Your email?');
  });
});

test.describe('V4-08 — contradiction guard + operator UI (editor)', () => {
  test('slider field exposes numeric operators; identical show/hide rules warn', async ({
    page,
    request,
  }) => {
    const { id } = await createForm(request, uniqueName('guard'), editorConfig());
    await page.goto(`/admin/forms/${id}/edit`);

    // Select the second question — the one that will carry the show/hide rules.
    await page.getByTestId('question-spine').getByRole('button', { name: /Reason/ }).click();

    // The condition editors moved out of the settings panel into the shared
    // per-question logic dialog: the panel now SUMMARISES the rules and this
    // button opens the one place that edits them. Everything below is unchanged
    // — same editors, same testids, one dialog around them.
    await page.getByTestId('question-logic-edit').click();
    await expect(page.getByTestId('logic-dialog')).toBeVisible();

    // The Visibility panel's Show/Hide field selects are present.
    await expect(page.getByRole('button', { name: 'Show when — Field' })).toBeVisible();

    // Show when references the slider → the numeric operator dropdown appears…
    await pickFromSelect(page, 'Show when — Field', 'Rate it');
    await expect(page.getByTestId('logic-show-op')).toBeVisible();

    // …and it offers the numeric comparison set (V4-07), not "matches any of".
    const showOpTrigger = page.getByRole('button', { name: 'Show when — Condition' });
    await showOpTrigger.click();
    const showOpList = page.getByRole('listbox', { name: 'Show when — Condition' });
    await expect(showOpList.getByRole('option', { name: 'Greater than', exact: true })).toBeVisible();
    await expect(showOpList.getByRole('option', { name: 'Between', exact: true })).toBeVisible();
    await showOpList.getByRole('option', { name: 'Equal to', exact: true }).click();
    await page.getByTestId('logic-show-value').fill('5');

    // No contradiction yet — the hide rule is still empty.
    await expect(page.getByTestId('logic-contradiction')).toHaveCount(0);

    // Hide when the SAME field equals the SAME value → the step could never show.
    await pickFromSelect(page, 'Hide when — Field', 'Rate it');
    await page.getByTestId('logic-hide-value').fill('5');

    // V4-08 guard fires: a prominent inline warning (role=alert).
    const warning = page.getByTestId('logic-contradiction');
    await expect(warning).toBeVisible();
    await expect(warning).toHaveAttribute('role', 'alert');

    // Removing the overlap (hide value 6) resolves it — the guard is reactive.
    await page.getByTestId('logic-hide-value').fill('6');
    await expect(page.getByTestId('logic-contradiction')).toHaveCount(0);
  });
});
