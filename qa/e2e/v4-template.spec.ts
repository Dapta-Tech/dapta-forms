import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * V4-11 — the guided empty-state template picker
 * (apps/web/app/admin/forms/[id]/edit/_components/empty-state.tsx).
 *
 * A brand-new form (zero questions) shows the guided empty state: a clear
 * "Start from scratch" option FIRST, then four template cards (Lead qualifier /
 * Contact / Feedback / RSVP). This spec locks in:
 *  a. the scratch option + every template card are real buttons (role=button)
 *     and clickable;
 *  b. picking the Lead qualifier template APPLIES its steps — the WYSIWYG canvas
 *     leaves the empty state and shows the template's first question;
 *  c. picking a template PRESERVES the name the user already gave the form — it
 *     is NOT replaced by the template's name ("Lead qualifier"). The name guard
 *     lives in form-editor.tsx `applyTemplate` (templates swap `config` only).
 *
 * Forms are created via the admin API with unique `v4tpl-` names and EMPTY
 * steps so the editor renders the guided empty state.
 */

const API = 'http://localhost:4400';

const RUN = Math.random().toString(36).slice(2, 8);
let seq = 0;
function uniqueName(label: string): string {
  seq += 1;
  return `v4tpl-${label}-${RUN}-${seq}`;
}

/** Create a form with NO questions so the editor shows the guided empty state. */
async function createEmptyForm(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post(`${API}/v1/forms`, {
    data: { name, config: { version: 1, steps: [] } },
  });
  expect(res.ok(), `form creation failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string };
  return body.id;
}

/** Open the editor and wait for the guided empty state to render. */
async function openEmptyState(page: Page, id: string): Promise<void> {
  await page.goto(`/admin/forms/${id}/edit`);
  await expect(page.getByTestId('empty-scratch')).toBeVisible({ timeout: 20_000 });
}

/** The form-name input in the editor header — a plain textbox (only the canvas
 *  title became a combobox). Scoped to <header> so it is locale-independent and
 *  never collides with the type-gallery search input. */
function nameInput(page: Page) {
  return page.locator('header input').first();
}

const TEMPLATE_IDS = ['lead', 'contact', 'feedback', 'rsvp'] as const;

test('the scratch option and every template card are buttons and are clickable', async ({
  page,
  request,
}) => {
  const id = await createEmptyForm(request, uniqueName('semantics'));
  await openEmptyState(page, id);

  // Start-from-scratch is the clear first option, and a real button.
  const scratch = page.getByRole('button', { name: /start from scratch/i });
  await expect(scratch).toBeVisible();
  await expect(page.getByTestId('empty-scratch')).toHaveJSProperty('tagName', 'BUTTON');

  // All four template cards are native buttons (implicit role=button).
  for (const tid of TEMPLATE_IDS) {
    const card = page.getByTestId(`empty-template-${tid}`);
    await expect(card).toBeVisible();
    await expect(card).toHaveJSProperty('tagName', 'BUTTON');
  }

  // The card exposes its label to assistive tech (role + accessible name).
  await expect(page.getByRole('button', { name: /lead qualifier/i })).toBeVisible();

  // Clickable: the scratch option opens the type gallery (an a11y dialog).
  await scratch.click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('picking the Lead qualifier template applies its steps to the canvas', async ({
  page,
  request,
}) => {
  const id = await createEmptyForm(request, uniqueName('applies'));
  await openEmptyState(page, id);

  await page.getByTestId('empty-template-lead').click();

  // The empty state is replaced by the WYSIWYG build canvas, and the selected
  // question is the template's first step (the corporate-email question).
  const title = page.getByTestId('canvas-title-input');
  await expect(title).toBeVisible({ timeout: 15_000 });
  await expect(title).toHaveValue(/work email/i);
  await expect(page.getByTestId('empty-scratch')).toHaveCount(0);
});

test('picking a template preserves the user-given form name (not replaced by the template name)', async ({
  page,
  request,
}) => {
  const original = uniqueName('keepname');
  const id = await createEmptyForm(request, original);
  await openEmptyState(page, id);

  // Sanity: the header shows the name the form was created with.
  await expect(nameInput(page)).toHaveValue(original);

  await page.getByTestId('empty-template-lead').click();

  // Steps were applied…
  await expect(page.getByTestId('canvas-title-input')).toBeVisible({ timeout: 15_000 });
  // …but the form KEEPS its name — it must NOT become "Lead qualifier".
  await expect(nameInput(page)).toHaveValue(original);
  await expect(nameInput(page)).not.toHaveValue('Lead qualifier');
});
