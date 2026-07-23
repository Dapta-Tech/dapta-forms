import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * V4-06 + V4-15 — the `@`/`[` recall-information picker on the canvas
 * (TokenTextarea in
 * apps/web/app/admin/forms/[id]/edit/_components/token-textarea.tsx).
 *
 * V4-06 (warning misclassification): a `[token]` whose field IS captured by a
 * step but that step comes AFTER the current one must warn `later` ("asked
 * after this step — it will be empty here"), NOT `unknown` ("doesn't exist").
 * `unknown` is reserved for a token no step captures anywhere in the form. The
 * real reported case: a Q2 email titled `Usa tu correo del trabajo
 * [presupuesto]` where `presupuesto` is a LATER multiple_choice (Q4).
 *
 * V4-15 (picker on the description): the engine's `resolveStepDisplay` now
 * interpolates `[key]` tokens in the `helper`/description too (with the same
 * orphaned-punctuation sweep as the title), and the public renderer paints the
 * resolved helper — so the `@`/`[` recall picker IS wired on the description,
 * exactly like the title. This spec locks that in (typing `@` there opens the
 * picker and inserts a token). The runtime interpolation itself is covered by
 * the engine unit tests + v4-fields2.spec.ts.
 *
 * Forms are created via the admin API with unique `v4tok-` names.
 */

const API = 'http://localhost:4400';

const RUN = Math.random().toString(36).slice(2, 8);
let seq = 0;
function uniqueName(label: string): string {
  seq += 1;
  return `v4tok-${label}-${RUN}-${seq}`;
}

const Q_NAME = '¿Cómo te llamas?';
const Q_EMAIL = 'Tu correo de trabajo';
const Q_COMPANY = '¿En qué empresa trabajas?';
const Q_BUDGET = '¿Cuál es tu presupuesto?';

/**
 * Q1 name (firstname/lastname) · Q2 email `email` · Q3 text `empresa` ·
 * Q4 multiple_choice `presupuesto` — so `presupuesto` is captured LATER than
 * the Q2 email whose title references `[presupuesto]`.
 */
function config() {
  return {
    version: 1,
    cover: { enabled: true, headline: 'V4 tokens QA', ctaText: 'Start' },
    steps: [
      { key: 'fullname', type: 'name', question: Q_NAME, required: false, fields: ['firstname', 'lastname'] },
      { key: 'email', type: 'email', question: Q_EMAIL, required: true },
      { key: 'empresa', type: 'text', question: Q_COMPANY },
      {
        key: 'presupuesto',
        type: 'multiple_choice',
        question: Q_BUDGET,
        options: [
          { label: 'Menos de 10k', value: 'low', points: 0 },
          { label: 'Más de 10k', value: 'high', points: 5 },
        ],
      },
    ],
  };
}

async function createForm(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post(`${API}/v1/forms`, { data: { name, config: config() } });
  expect(res.ok(), `form creation failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string };
  return body.id;
}

function title(page: Page) {
  return page.getByTestId('canvas-title-input');
}

async function selectStep(page: Page, questionText: string): Promise<void> {
  await page.getByRole('button', { name: questionText }).first().click();
}

async function openEditor(page: Page, id: string): Promise<void> {
  await page.goto(`/admin/forms/${id}/edit`);
  await expect(title(page)).toHaveValue(Q_NAME);
}

test('V4-06: a token captured by a LATER step warns `later`, not `unknown`; a token no step captures warns `unknown`', async ({
  page,
  request,
}) => {
  const id = await createForm(request, uniqueName('later-vs-unknown'));
  await openEditor(page, id);

  // Select Q2 (the email) and reference `[presupuesto]` — captured at Q4.
  await selectStep(page, Q_EMAIL);
  await expect(title(page)).toHaveValue(Q_EMAIL);

  await title(page).fill('Usa tu correo del trabajo [presupuesto]');
  const warning = page.getByTestId('token-warning');
  await expect(warning).toHaveCount(1);
  // The core of V4-06: it exists (later), so the kind is `later`, NOT `unknown`.
  await expect(warning).toHaveAttribute('data-kind', 'later');
  await expect(warning).toContainText('[presupuesto]');
  await expect(warning).toContainText('after this step');

  // A token that matches NO step's field key → `unknown`.
  await title(page).fill('Hola [nonexistent]');
  await expect(warning).toHaveCount(1);
  await expect(warning).toHaveAttribute('data-kind', 'unknown');
  await expect(warning).toContainText('[nonexistent]');

  // Referencing an EARLIER-captured field (firstname, from Q1) → no warning.
  await title(page).fill('Hola [firstname]');
  await expect(page.getByTestId('token-warning')).toHaveCount(0);

  // Clearing the token clears the chip entirely.
  await title(page).fill('Hola');
  await expect(page.getByTestId('token-warning')).toHaveCount(0);
});

test('V4-15: the description textarea HAS the token picker (the engine now interpolates the description)', async ({
  page,
  request,
}) => {
  const id = await createForm(request, uniqueName('desc-picker'));
  await openEditor(page, id);

  await selectStep(page, Q_EMAIL);
  await expect(title(page)).toHaveValue(Q_EMAIL);

  // Typing `@` in the title opens the picker (control: the picker works). Type
  // it at the START — an `@` typed straight after a word character is treated as
  // an email address and deliberately does NOT open the picker (V4-06), and this
  // title ends in a letter.
  await title(page).click();
  await page.keyboard.press('Home');
  await title(page).pressSequentially('@');
  await expect(page.getByTestId('token-picker')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('token-picker')).toHaveCount(0);

  // Typing `@` in the description ALSO opens the picker now — the engine
  // interpolates `[key]` tokens in the description, so the recall affordance is
  // wired there too. Tokens = fields captured BEFORE Q2: the Q1 name subfields.
  const description = page.getByTestId('canvas-description-input');
  await description.click();
  await description.pressSequentially('@');
  await expect(page.getByTestId('token-picker')).toBeVisible();
  const options = page.getByTestId('token-option');
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toHaveAttribute('data-key', 'firstname');
  await expect(options.nth(1)).toHaveAttribute('data-key', 'lastname');

  // Enter inserts the engine token into the description value.
  await page.keyboard.press('Enter');
  await expect(description).toHaveValue('[firstname]');
  await expect(page.getByTestId('token-picker')).toHaveCount(0);
});
