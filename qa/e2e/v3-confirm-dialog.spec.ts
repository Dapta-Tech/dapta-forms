import { test, expect, type APIRequestContext, type Page, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * V3 — branded ConfirmDialog replaces every native browser `confirm()`.
 *
 * `apps/web/components/ui/confirm-dialog.tsx` (useConfirmDialog hook) now guards
 * the six destructive actions (delete form / question / submission, remove
 * member, reset email template, disconnect integration) with an in-app
 * role=alertdialog styled with the app tokens — no more OS "localhost says…"
 * popup. These specs exercise the three cheapest-to-drive surfaces:
 *   1. Forms list: kebab → Delete shows the dialog (destructive confirm button,
 *      initial focus on Cancel); Cancel keeps the form; Confirm deletes it.
 *   2. Escape closes the dialog without deleting.
 *   3. The editor's delete-question button is guarded by the same dialog.
 *   4. /admin/integrations Disconnect opens the dialog — CANCELLED both times;
 *      the QA env's HubSpot connection is real and must stay connected.
 *
 * If a native confirm() were still wired anywhere here, the specs would hang or
 * auto-dismiss (Playwright dismisses unexpected native dialogs) — every flow
 * asserts the branded [data-testid=confirm-dialog] instead.
 */

const API = 'http://localhost:4400';

// Per-run identity: unique names/slugs per run (v3w9- prefix per QA convention).
const RUN = randomUUID().slice(0, 8);
let seq = 0;
const uid = (label: string) => `v3w9-${label}-${RUN}-${++seq}`;

const dialog = (page: Page): Locator => page.getByTestId('confirm-dialog');
const confirmBtn = (page: Page): Locator => page.getByTestId('confirm-dialog-confirm');
const cancelBtn = (page: Page): Locator => page.getByTestId('confirm-dialog-cancel');

/** Minimal multi-step config so the editor has questions to delete. */
function baseConfig() {
  return {
    version: 1,
    cover: { enabled: true, headline: 'QA v3w9 confirm dialog', ctaText: 'Start' },
    steps: [
      { key: 'email', type: 'email', question: 'Your email?', required: true },
      {
        key: 'pick',
        type: 'multiple_choice',
        question: 'Pick one',
        options: [
          { label: 'Option A', value: 'a' },
          { label: 'Option B', value: 'b' },
        ],
      },
      { key: 'details', type: 'text', question: 'A few details' },
    ],
  };
}

async function createForm(
  request: APIRequestContext,
  name: string,
): Promise<{ id: string; slug: string; name: string }> {
  const res = await request.post(`${API}/v1/forms`, {
    data: { name, slug: name, config: baseConfig() },
  });
  expect(res.ok(), `POST /v1/forms ${res.status()} ${await res.text()}`).toBeTruthy();
  const form = (await res.json()) as { id: string; slug: string };
  return { id: form.id, slug: form.slug, name };
}

async function formExists(request: APIRequestContext, id: string): Promise<boolean> {
  const res = await request.get(`${API}/v1/forms`);
  expect(res.ok(), `GET /v1/forms ${res.status()}`).toBeTruthy();
  const forms = (await res.json()) as Array<{ id: string }>;
  return forms.some((f) => f.id === id);
}

/** Best-effort cleanup for forms the UI flow did not delete. */
async function deleteForm(request: APIRequestContext, id: string): Promise<void> {
  await request.delete(`${API}/v1/forms/${id}`);
}

/** Open the forms-list kebab for `row` and click its Delete menu item. */
async function openDeleteFromKebab(row: Locator): Promise<void> {
  await row.getByTestId('form-row-menu').click();
  await row.getByRole('menuitem', { name: /^(Delete|Eliminar)$/ }).click();
}

test('forms list: kebab Delete opens the branded dialog — Cancel keeps the form, Confirm deletes it', async ({
  page,
  request,
}) => {
  const form = await createForm(request, uid('del'));
  try {
    await page.goto('/admin/forms');
    const row = page.getByTestId('form-row').filter({ hasText: form.name });
    await expect(row).toHaveCount(1);

    // Kebab → Delete opens the branded alertdialog (NOT a native popup).
    await openDeleteFromKebab(row);
    const dlg = dialog(page);
    await expect(dlg).toBeVisible();
    await expect(dlg).toHaveAttribute('role', 'alertdialog');
    await expect(dlg).toHaveAttribute('aria-modal', 'true');
    // Title + the site's existing confirm copy as the body.
    await expect(dlg.getByRole('heading', { name: 'Delete form' })).toBeVisible();
    await expect(dlg.getByText('Delete this form and all its submissions?')).toBeVisible();
    // Destructive styling on the confirm button; initial focus on Cancel.
    await expect(confirmBtn(page)).toHaveClass(/destructive/);
    await expect(cancelBtn(page)).toBeFocused();

    // Cancel → dialog closes, nothing deleted (UI row + API row both intact).
    await cancelBtn(page).click();
    await expect(dlg).toHaveCount(0);
    await expect(row).toHaveCount(1);
    expect(await formExists(request, form.id)).toBe(true);

    // Again → Confirm → the form is gone from the list and the API.
    await openDeleteFromKebab(row);
    await expect(dialog(page)).toBeVisible();
    await confirmBtn(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(row).toHaveCount(0, { timeout: 10_000 });
    await expect
      .poll(() => formExists(request, form.id), {
        timeout: 10_000,
        message: 'confirmed delete never removed the form from GET /v1/forms',
      })
      .toBe(false);
  } finally {
    await deleteForm(request, form.id); // no-op when the confirm already deleted it
  }
});

test('Escape closes the dialog without deleting', async ({ page, request }) => {
  const form = await createForm(request, uid('esc'));
  try {
    await page.goto('/admin/forms');
    const row = page.getByTestId('form-row').filter({ hasText: form.name });
    await expect(row).toHaveCount(1);

    await openDeleteFromKebab(row);
    await expect(dialog(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(row).toHaveCount(1);
    expect(await formExists(request, form.id)).toBe(true);
  } finally {
    await deleteForm(request, form.id);
  }
});

test('editor: delete-question is guarded by the branded dialog', async ({ page, request }) => {
  const form = await createForm(request, uid('edit'));
  try {
    await page.goto(`/admin/forms/${form.id}/edit`);

    // First question is selected by default; the settings pane shows Delete.
    const deleteBtn = page.getByRole('button', { name: /^(Delete question|Eliminar pregunta)$/ });
    await expect(deleteBtn).toBeVisible();
    await expect(page.getByText('Question 1 of 3')).toBeVisible();

    await deleteBtn.click();
    const dlg = dialog(page);
    await expect(dlg).toBeVisible();
    await expect(dlg).toHaveAttribute('role', 'alertdialog');
    await expect(dlg.getByRole('heading', { name: 'Delete question' })).toBeVisible();
    await expect(dlg.getByText('Delete this question?')).toBeVisible();
    await expect(confirmBtn(page)).toHaveClass(/destructive/);

    // Cancel → still 3 questions.
    await cancelBtn(page).click();
    await expect(dlg).toHaveCount(0);
    await expect(page.getByText('Question 1 of 3')).toBeVisible();

    // Confirm → the question is removed (2 remain).
    await deleteBtn.click();
    await expect(dialog(page)).toBeVisible();
    await confirmBtn(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByText('Question 1 of 2')).toBeVisible();
  } finally {
    await deleteForm(request, form.id);
  }
});

test('integrations: Disconnect opens the branded dialog — Cancel keeps HubSpot connected', async ({
  page,
  request,
}) => {
  // Preflight: the QA env has a REAL HubSpot connection — this test must only
  // ever Cancel the dialog (never confirm a disconnect).
  const pre = await request.get(`${API}/v1/integrations`);
  expect(pre.ok(), `GET /v1/integrations ${pre.status()}`).toBeTruthy();
  const { providers } = (await pre.json()) as {
    providers: Array<{ provider: string; connected: boolean }>;
  };
  expect(
    providers.find((p) => p.provider === 'hubspot')?.connected,
    'QA env precondition: HubSpot must be connected (see qa/QA-CONTEXT.md)',
  ).toBe(true);

  await page.goto('/admin/integrations');
  const card = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'HubSpot' }) });
  await expect(card.getByText(/^(Connected|Conectado)$/)).toBeVisible();

  await card.getByRole('button', { name: /^(Disconnect|Desconectar)$/ }).click();
  const dlg = dialog(page);
  await expect(dlg).toBeVisible();
  await expect(dlg).toHaveAttribute('role', 'alertdialog');
  await expect(dlg.getByRole('heading', { name: 'Disconnect HubSpot' })).toBeVisible();
  await expect(dlg.getByText('Disconnect HubSpot for this account?')).toBeVisible();
  await expect(confirmBtn(page)).toHaveClass(/destructive/);

  // CANCEL — the connection must survive.
  await cancelBtn(page).click();
  await expect(dlg).toHaveCount(0);
  await expect(card.getByText(/^(Connected|Conectado)$/)).toBeVisible();

  const post = await request.get(`${API}/v1/integrations`);
  expect(post.ok()).toBeTruthy();
  const after = (await post.json()) as {
    providers: Array<{ provider: string; connected: boolean }>;
  };
  expect(after.providers.find((p) => p.provider === 'hubspot')?.connected).toBe(true);
});
