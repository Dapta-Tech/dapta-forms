import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Draft → Publish workflow, end-to-end.
 *
 * Contract under test (see apps/api/src/admin-crud.controller.ts and
 * apps/web/app/admin/forms/[id]/edit/publish-button.tsx):
 * - POST /v1/forms writes LIVE config; edits in the builder autosave (~0.9s
 *   debounce) as an UNPUBLISHED draft (PUT stores draft_config only).
 * - While a draft is pending, the editor shows an "Unpublished changes" badge
 *   and the public renderer keeps serving the OLD live config.
 * - POST /v1/forms/:id/publish copies draft → live, stamps publishedAt and
 *   clears the draft; the badge clears and the Publish button disables until
 *   the next successful autosave re-arms it.
 */

const API = 'http://localhost:4400';

const OLD_Q = 'What is your company size?';
const NEW_Q = 'How many employees work at your company?';
const REARM_Q = 'Third revision after publish';

function baseConfig(question: string) {
  return {
    version: 1,
    cover: { enabled: false },
    steps: [
      { key: 'q1', type: 'text', question },
      { key: 'q2', type: 'email', question: 'Work email?' },
    ],
  };
}

async function createForm(request: APIRequestContext, name: string) {
  const res = await request.post(`${API}/v1/forms`, {
    data: { name, config: baseConfig(OLD_Q) },
  });
  expect(res.status(), 'POST /v1/forms should create the form').toBe(201);
  const body = (await res.json()) as { id: string; slug: string };
  expect(body.id).toBeTruthy();
  return body;
}

/** Public path for a form owned by the admin principal. Derived from /v1/me
 *  (same as the editor's own "view live" link) — the QA principal's account
 *  code is NOT the seeded `acme` account, so it must never be hardcoded. */
async function publicPath(request: APIRequestContext, slug: string) {
  const res = await request.get(`${API}/v1/me`);
  expect(res.ok()).toBeTruthy();
  const me = (await res.json()) as { accountCode: string; handle: string | null };
  return `/${me.accountCode}/${me.handle ?? 'me'}/${slug}`;
}

async function getForm(request: APIRequestContext, id: string) {
  const res = await request.get(`${API}/v1/forms/${id}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as {
    config: { steps: { question?: string }[] };
    draftConfig: { steps: { question?: string }[] } | null;
    publishedAt: number | null;
  };
}

/** The WYSIWYG canvas title textarea for the currently selected question.
 *  Since the @ token picker landed it carries role="combobox" (TokenTextarea),
 *  so it is NOT a role=textbox anymore — target the stable testid (same as
 *  v3-at-picker.spec.ts). fill()/toHaveValue() still work: it stays a real
 *  <textarea>. */
function canvasTitle(page: Page) {
  return page.getByTestId('canvas-title-input');
}

/** Edit the first question's text in the builder and wait for the autosave
 *  (debounced ~0.9s) to land — signalled by the "Unpublished changes" badge. */
async function editFirstQuestion(page: Page, text: string) {
  const title = canvasTitle(page);
  await expect(title).toBeVisible({ timeout: 20_000 });
  await title.fill(text);
  // The badge only renders AFTER a successful draft save, so it doubles as
  // the autosave-complete signal.
  await expect(page.getByText('Unpublished changes')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
}

test('builder edits autosave as a draft: badge arms, public page keeps the old question', async ({
  page,
  request,
}) => {
  const form = await createForm(request, `qa-draftpub-draft-${Date.now()}`);

  await page.goto(`/admin/forms/${form.id}/edit`);
  const title = canvasTitle(page);
  await expect(title).toBeVisible({ timeout: 20_000 });
  await expect(title).toHaveValue(OLD_Q); // fresh form: editor loads the live config

  // No draft yet → nothing to publish.
  await expect(page.getByText('Unpublished changes')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();

  await editFirstQuestion(page, NEW_Q);
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();

  // API: live config untouched, draft carries the edit, not yet published.
  const before = await getForm(request, form.id);
  expect(before.config.steps[0]?.question).toBe(OLD_Q);
  expect(before.draftConfig?.steps[0]?.question).toBe(NEW_Q);
  expect(before.publishedAt).toBeNull();

  // Public page still serves the OLD live question.
  await page.goto(await publicPath(request, form.slug));
  await expect(page.locator('h2.pf__question').first()).toHaveText(OLD_Q, { timeout: 20_000 });
  await expect(page.getByText(NEW_Q)).toHaveCount(0);
});

test('publish makes the draft live, clears the badge, and re-editing re-arms it', async ({
  page,
  request,
}) => {
  const form = await createForm(request, `qa-draftpub-publish-${Date.now()}`);

  await page.goto(`/admin/forms/${form.id}/edit`);
  await editFirstQuestion(page, NEW_Q);

  // Publish → success toast.
  const publishBtn = page.getByRole('button', { name: 'Publish', exact: true });
  await expect(publishBtn).toBeEnabled();
  await publishBtn.click();
  await expect(
    page.getByText('Changes published — your form is live.'),
  ).toBeVisible({ timeout: 15_000 });

  // Badge clears and the button disables (nothing left to publish).
  await expect(page.getByText('Unpublished changes')).toHaveCount(0);
  await expect(publishBtn).toBeDisabled();

  // API: draft cleared, publishedAt stamped, live config carries the new text.
  await expect
    .poll(async () => (await getForm(request, form.id)).draftConfig, {
      timeout: 10_000,
    })
    .toBeNull();
  const after = await getForm(request, form.id);
  expect(after.config.steps[0]?.question).toBe(NEW_Q);
  expect(after.publishedAt).toEqual(expect.any(Number));

  // Editing again re-arms the badge and re-enables Publish.
  await editFirstQuestion(page, REARM_Q);
  await expect(publishBtn).toBeEnabled();

  // Public page (fresh load) serves the PUBLISHED text — not the old live
  // config, and not the still-unpublished re-edit.
  await page.goto(await publicPath(request, form.slug));
  await expect(page.locator('h2.pf__question').first()).toHaveText(NEW_Q, { timeout: 20_000 });
  await expect(page.getByText(REARM_Q)).toHaveCount(0);
  await expect(page.getByText(OLD_Q)).toHaveCount(0);
});
