import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * V4-06 (highlighting) — valid [field] tokens must be visibly tokens in the
 * editor, not styled identically to prose.
 *
 * The recall picker and warning chips existed, but a `[firstname]` you typed
 * looked exactly like the surrounding text. TokenTextarea now renders a mirror
 * layer behind a transparent textarea: a token that resolves HERE is tinted
 * (data-kind="valid"), while a `[later]`/unknown token or a bare `@key` (literal
 * text the engine never substitutes) is flagged (data-kind="invalid") — the same
 * split the warnings make, now inline.
 *
 * The mirror is behind the real textarea, so this asserts against the mirror's
 * marks (data-testid="token-mark") keyed to the title editor.
 */

const API = 'http://localhost:4400';
const RUN = Math.random().toString(36).slice(2, 8);
let seq = 0;

const Q_NAME = '¿Cómo te llamas?';
const Q_EMAIL = 'Tu correo de trabajo';
const Q_BUDGET = '¿Cuál es tu presupuesto?';

/** Q1 name (firstname/lastname) → Q2 email → Q4 multiple_choice `presupuesto`
 *  (captured LATER than the Q2 title that references it). */
function config() {
  return {
    version: 1,
    cover: { enabled: true, headline: 'V5 highlight QA', ctaText: 'Start' },
    steps: [
      { key: 'fullname', type: 'name', question: Q_NAME, required: false, fields: ['firstname', 'lastname'] },
      { key: 'email', type: 'email', question: Q_EMAIL, required: true },
      {
        key: 'presupuesto',
        type: 'multiple_choice',
        question: Q_BUDGET,
        options: [{ label: 'Menos', value: 'low', points: 0 }],
      },
    ],
  };
}

async function createForm(request: APIRequestContext): Promise<string> {
  seq += 1;
  const res = await request.post(`${API}/v1/forms`, {
    data: { name: `v5hl-${RUN}-${seq}`, config: config() },
  });
  expect(res.ok(), `create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

const title = (page: Page) => page.getByTestId('canvas-title-input');
const highlight = (page: Page) => page.getByTestId('canvas-title-input-highlight');

test('valid tokens are tinted and unresolved ones flagged in the editor', async ({ page, request }) => {
  test.setTimeout(60_000);
  const id = await createForm(request);
  await page.goto(`/admin/forms/${id}/edit`);
  await expect(title(page)).toHaveValue(Q_NAME);

  // Select the Q2 email step: firstname is captured earlier (valid here),
  // presupuesto later (invalid here), @nope names nothing (invalid).
  await page.getByRole('button', { name: Q_EMAIL }).first().click();
  await expect(title(page)).toHaveValue(Q_EMAIL);

  await title(page).fill('Hola [firstname], [presupuesto] y @nope');

  // The mirror renders three marks with the right verdicts.
  const marks = highlight(page).getByTestId('token-mark');
  await expect(marks).toHaveCount(3);

  const valid = highlight(page).locator('[data-testid="token-mark"][data-kind="valid"]');
  const invalid = highlight(page).locator('[data-testid="token-mark"][data-kind="invalid"]');
  await expect(valid).toHaveCount(1);
  await expect(valid).toHaveText('[firstname]');
  await expect(invalid).toHaveCount(2);
  await expect(invalid.nth(0)).toHaveText('[presupuesto]');
  await expect(invalid.nth(1)).toHaveText('@nope');

  // A valid token is visibly distinct — its computed color is the primary token,
  // not the plain title color (proves the tint actually paints).
  const validColor = await valid.evaluate((el) => getComputedStyle(el).color);
  const plainColor = await highlight(page)
    .locator('span:not([data-testid])')
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  expect(validColor).not.toBe(plainColor);

  // The textarea itself is still the interactive control and holds the raw text.
  await expect(title(page)).toHaveValue('Hola [firstname], [presupuesto] y @nope');
});
