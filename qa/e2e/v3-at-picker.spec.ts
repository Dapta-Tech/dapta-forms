import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * V3 — Typeform "Recall information" parity in the builder: the `@` token
 * picker on the canvas title textarea (TokenTextarea in
 * apps/web/app/admin/forms/[id]/edit/_components/token-textarea.tsx).
 *
 * Under test:
 *  1. PICKER — with q1 = name step (firstname/lastname) and q2 = short text,
 *     selecting q2 and typing `@` in its title opens a listbox of the fields
 *     captured BEFORE q2: exactly the name subfields (the engine's
 *     `interpolate` resolves tokens from the answers map, where a name step
 *     stores one answer per subfield and never under its own key) — and NOT
 *     q2's own key. Typing filters; Enter inserts `[firstname]` and the
 *     textarea value carries the literal token.
 *  2. DISCOVERABILITY — a permanent muted hint under the title ("Type @ to
 *     insert a previous answer") whenever at least one earlier field exists;
 *     q1 (nothing earlier) shows no hint and `@` opens the empty state.
 *  3. WARNINGS (authoring guidance, non-blocking) — a `[token]` in q1's title
 *     that no step captures flags "doesn't exist"; a token captured by a LATER
 *     step (q2's key) flags "asked after this step"; fixing the text clears
 *     the chip. data-testid="token-warning".
 *  4. `[` trigger + click-select — `[last` filters to lastname and clicking
 *     the option completes the bracket to `[lastname]`; Escape closes.
 *
 * Forms are created via the admin API with unique `v3w10-` names (per-process
 * random token + counter; Date.now is banned). Editor-only — the runtime
 * interpolation itself is covered by v2-interpolation.spec.ts.
 */

const API = 'http://localhost:4400';

const RUN = Math.random().toString(36).slice(2, 8);
let seq = 0;
function uniqueName(label: string): string {
  seq += 1;
  return `v3w10-atpicker-${label}-${RUN}-${seq}`;
}

const Q1 = "What's your name?";
const Q2 = 'Tell us more';

/** q1 name (subfields firstname/lastname) + q2 short text (key `topic`). */
function config() {
  return {
    version: 1,
    cover: { enabled: true, headline: 'At-picker QA', ctaText: 'Start' },
    steps: [
      {
        key: 'fullname',
        type: 'name',
        question: Q1,
        required: false,
        fields: ['firstname', 'lastname'],
      },
      { key: 'topic', type: 'text', question: Q2 },
    ],
  };
}

/** POST /v1/forms → form id (create writes live config; editor works on draft). */
async function createForm(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post(`${API}/v1/forms`, { data: { name, config: config() } });
  expect(res.ok(), `form creation failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string };
  return body.id;
}

/** The canvas title textarea (the TokenTextarea under test). */
function title(page: Page) {
  return page.getByTestId('canvas-title-input');
}

/** Select a question by clicking its spine row (desktop layout). */
async function selectStep(page: Page, questionText: string): Promise<void> {
  await page.getByRole('button', { name: questionText }).first().click();
}

/** Open the editor and wait for the canvas to show q1 (auto-selected). */
async function openEditor(page: Page, id: string): Promise<void> {
  await page.goto(`/admin/forms/${id}/edit`);
  await expect(title(page)).toHaveValue(Q1);
}

test('@ on q2 lists ONLY the earlier name subfields, filters, and Enter inserts [firstname]; hint is visible', async ({
  page,
  request,
}) => {
  const id = await createForm(request, uniqueName('picker'));
  await openEditor(page, id);

  await selectStep(page, Q2);
  await expect(title(page)).toHaveValue(Q2);

  // Discoverability: the permanent muted hint under the title.
  await expect(page.getByTestId('token-hint')).toContainText('Type @ to insert a previous answer');

  // Type `@` at the end of the title → the anchored listbox opens.
  await title(page).click();
  await page.keyboard.press('End');
  await title(page).pressSequentially('@');
  await expect(page.getByTestId('token-picker')).toBeVisible();

  // Exactly the fields captured BEFORE q2: the name step's two subfields —
  // the tokens the engine's interpolate can resolve here. Never q2's own key.
  const options = page.getByTestId('token-option');
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toHaveAttribute('data-key', 'firstname');
  await expect(options.nth(1)).toHaveAttribute('data-key', 'lastname');
  await expect(page.locator('[data-testid="token-option"][data-key="topic"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="token-option"][data-key="fullname"]')).toHaveCount(0);

  // Typing filters (matches key and question label, case-insensitive).
  await title(page).pressSequentially('fir');
  await expect(options).toHaveCount(1);
  await expect(options.first()).toHaveAttribute('data-key', 'firstname');

  // Enter replaces the typed `@fir` with the literal engine token.
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('token-picker')).toHaveCount(0);
  await expect(title(page)).toHaveValue(`${Q2}[firstname]`);

  // The token renders no warning — firstname IS captured before this step.
  await expect(page.getByTestId('token-warning')).toHaveCount(0);
  await expect(page.getByTestId('token-hint')).toBeVisible();
});

test('q1 warnings: unknown token vs later-step token (non-blocking authoring guidance); no hint without earlier fields', async ({
  page,
  request,
}) => {
  const id = await createForm(request, uniqueName('warnings'));
  await openEditor(page, id);

  // q1 has nothing earlier to insert → no discoverability hint.
  await expect(page.getByTestId('token-hint')).toHaveCount(0);

  // A token no step captures → "doesn't exist in this form".
  await title(page).fill('Hello [nonexistent]');
  const warning = page.getByTestId('token-warning');
  await expect(warning).toHaveCount(1);
  await expect(warning).toHaveAttribute('data-kind', 'unknown');
  await expect(warning).toContainText('[nonexistent]');

  // A token captured by a LATER step (q2's key) → "asked after this step".
  await title(page).fill('Hello [topic]');
  await expect(warning).toHaveCount(1);
  await expect(warning).toHaveAttribute('data-kind', 'later');
  await expect(warning).toContainText('[topic]');
  await expect(warning).toContainText('after this step');

  // Fixing the text clears the chip — guidance only, never blocking.
  await title(page).fill('Hello');
  await expect(warning).toHaveCount(0);

  // `@` on the first question opens the empty state (nothing earlier).
  await title(page).click();
  await page.keyboard.press('End');
  await title(page).pressSequentially('@');
  await expect(page.getByTestId('token-picker')).toBeVisible();
  await expect(page.getByTestId('token-picker')).toContainText('No earlier answers yet');
  await expect(page.getByTestId('token-option')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('token-picker')).toHaveCount(0);
});

test('[ trigger completes the bracket via click-select; Escape closes the picker', async ({
  page,
  request,
}) => {
  const id = await createForm(request, uniqueName('bracket'));
  await openEditor(page, id);

  await selectStep(page, Q2);
  await expect(title(page)).toHaveValue(Q2);

  // `[last` opens + filters; clicking the option completes `[lastname]`.
  await title(page).click();
  await page.keyboard.press('End');
  await title(page).pressSequentially('[last');
  const options = page.getByTestId('token-option');
  await expect(options).toHaveCount(1);
  await expect(options.first()).toHaveAttribute('data-key', 'lastname');
  await options.first().click();
  await expect(page.getByTestId('token-picker')).toHaveCount(0);
  await expect(title(page)).toHaveValue(`${Q2}[lastname]`);
  await expect(page.getByTestId('token-warning')).toHaveCount(0);

  // Escape closes without inserting.
  await title(page).pressSequentially('@');
  await expect(page.getByTestId('token-picker')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('token-picker')).toHaveCount(0);
  await expect(title(page)).toHaveValue(`${Q2}[lastname]@`);
});

test('variants "Ask instead" textarea gets the same @ picker (tokens = fields before that step)', async ({
  page,
  request,
}) => {
  const id = await createForm(request, uniqueName('variants'));
  await openEditor(page, id);

  await selectStep(page, Q2);
  await expect(title(page)).toHaveValue(Q2);

  // Enable "Dynamic question" and add a variant row in the settings panel.
  await page.getByRole('switch', { name: 'Vary the question by a field' }).click();
  await page.getByRole('button', { name: 'Add variant' }).click();

  // Type `@` in the "Ask instead" textarea → the earlier name subfields.
  const askInstead = page.getByLabel('Ask instead');
  await askInstead.click();
  await askInstead.pressSequentially('@');
  await expect(page.getByTestId('token-picker')).toBeVisible();
  const options = page.getByTestId('token-option');
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toHaveAttribute('data-key', 'firstname');

  // Enter inserts the token into the variant text.
  await page.keyboard.press('Enter');
  await expect(askInstead).toHaveValue('[firstname]');
  await expect(page.getByTestId('token-picker')).toHaveCount(0);
});
