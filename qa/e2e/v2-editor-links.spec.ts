import { test, expect, type APIRequestContext, type BrowserContext } from '@playwright/test';

/**
 * N4 — editor header link actions (copy-link + open-in-new-tab).
 *
 * Under test: apps/web/app/admin/forms/[id]/edit/link-actions.tsx, rendered by
 * form-editor.tsx in the topbar's first row beside Publish. The public path is
 * `/${accountCode}/${handle ?? 'me'}/${slug}` (see edit/page.tsx) — resolved
 * here from GET /v1/me so the QA principal's real account code is never
 * hardcoded (it is NOT necessarily `acme`).
 *
 * The three actions are ICON-ONLY buttons, visible in the header (labels live
 * on title/aria-label). They were labelled buttons once, then briefly a single
 * popover menu — which tested as one hop too many and was reverted.
 *
 *   1. The header exposes [data-testid="editor-copy-link"] (a <button>) and
 *      [data-testid="editor-open-form"] (an <a>).
 *   2. editor-open-form opens the public form in a new tab: it is an anchor with
 *      target="_blank" whose href resolves to the form's public path.
 *   3. Clicking editor-copy-link flips it into a transient "copied" state (icon
 *      pi-link → pi-check) within 2s. Clipboard-write permission is granted so
 *      the flip — which the component performs only after a successful copy —
 *      actually fires; the grant is best-effort so a blocked clipboard can never
 *      crash the run.
 */

const API = 'http://localhost:4400';
const ORIGIN = 'http://localhost:3400';

// Per-run counter (Date.now is intentionally avoided) keeps each form name
// unique within a run without leaking wall-clock time into fixtures.
let formSeq = 0;

function baseConfig() {
  return {
    version: 1,
    cover: { enabled: false },
    steps: [
      { key: 'q1', type: 'text', question: 'Your name?' },
      { key: 'q2', type: 'email', question: 'Work email?' },
    ],
  };
}

async function createForm(request: APIRequestContext, label: string, workerIndex: number) {
  formSeq += 1;
  const name = `qa-editor-links-${label}-w${workerIndex}-${formSeq}`;
  const res = await request.post(`${API}/v1/forms`, { data: { name, config: baseConfig() } });
  expect(res.status(), 'POST /v1/forms should create the form').toBe(201);
  const body = (await res.json()) as { id: string; slug: string };
  expect(body.id).toBeTruthy();
  expect(body.slug).toBeTruthy();
  return body;
}

/** Same derivation the editor page uses — never hardcode the account code. */
async function publicPath(request: APIRequestContext, slug: string) {
  const res = await request.get(`${API}/v1/me`);
  expect(res.ok(), 'GET /v1/me should resolve the principal').toBeTruthy();
  const me = (await res.json()) as { accountCode: string; handle: string | null };
  return `/${me.accountCode}/${me.handle ?? 'me'}/${slug}`;
}

/**
 * Best-effort clipboard-write grant so navigator.clipboard.writeText resolves
 * and the component's post-copy flip fires. Never fatal: if the permission name
 * is unsupported the flip assertion still guards the real behavior.
 */
async function allowClipboard(context: BrowserContext) {
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  } catch {
    /* permission unsupported on this browser — proceed; the flip assertion still applies */
  }
}

test.describe('N4 — editor header link actions', () => {
  test('header renders copy-link and open-form controls', async ({ page, request }, testInfo) => {
    const form = await createForm(request, 'header', testInfo.workerIndex);
    await page.goto(`/admin/forms/${form.id}/edit`);

    const copyLink = page.getByTestId('editor-copy-link');
    const openForm = page.getByTestId('editor-open-form');
    await expect(copyLink, 'copy-link control present in header').toBeVisible({ timeout: 25_000 });
    await expect(openForm, 'open-form control present in header').toBeVisible();

    // Exactly one of each, and the expected element types (see link-actions.tsx).
    await expect(page.locator('button[data-testid="editor-copy-link"]')).toHaveCount(1);
    await expect(page.locator('a[data-testid="editor-open-form"]')).toHaveCount(1);
  });

  test('open-form is a target=_blank anchor to the form public path', async ({ page, request }, testInfo) => {
    const form = await createForm(request, 'open', testInfo.workerIndex);
    const expectedPath = await publicPath(request, form.slug);

    await page.goto(`/admin/forms/${form.id}/edit`);

    const openForm = page.locator('a[data-testid="editor-open-form"]');
    await expect(openForm).toBeVisible({ timeout: 25_000 });
    await expect(openForm, 'opens in a new tab').toHaveAttribute('target', '_blank');
    await expect(openForm, 'external open carries noreferrer').toHaveAttribute('rel', /noreferrer/);
    // Raw attribute is the server-stable relative path…
    await expect(openForm, 'href is the form public path').toHaveAttribute('href', expectedPath);
    // …and it resolves against the live origin to the absolute public URL.
    const resolved = await openForm.evaluate((el) => (el as HTMLAnchorElement).href);
    expect(resolved).toBe(`${ORIGIN}${expectedPath}`);
  });

  test('copy-link flips to a transient copied state on click', async ({ page, context, request }, testInfo) => {
    await allowClipboard(context);
    const form = await createForm(request, 'copy', testInfo.workerIndex);
    await page.goto(`/admin/forms/${form.id}/edit`);

    const copyLink = page.getByTestId('editor-copy-link');
    const icon = copyLink.locator('i');
    await expect(copyLink).toBeVisible({ timeout: 25_000 });

    // Resting state: the link icon, never the check.
    await expect(icon, 'starts on the link icon').toHaveClass(/pi-link/);
    await expect(icon).not.toHaveClass(/pi-check/);

    // Click then assert the copied flip, retrying the pair to absorb client
    // hydration timing. Each click re-arms the 2s "copied" window, so repeated
    // clicks are harmless; toHaveClass resolves on first match, so the auto-
    // revert cannot race the assertion.
    await expect(async () => {
      await copyLink.click();
      await expect(icon).toHaveClass(/pi-check/, { timeout: 1_000 });
    }).toPass({ timeout: 12_000 });
  });
});
