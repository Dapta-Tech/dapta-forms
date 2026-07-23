import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

/**
 * V3 — /admin/forms redesigned as a single-column list of action rows.
 *
 * Under test: apps/web/app/admin/forms/page.tsx (rows, first-class actions),
 * components/copy-link.tsx (CopyLinkIcon compact variant) and
 * app/admin/forms/form-row-actions.tsx (kebab trimmed to Duplicate/Delete).
 *
 *   1. Each form renders a [data-testid="form-row"] exposing first-class
 *      actions: form-row-edit / -submissions / -analytics / -connect plus the
 *      icon-only form-row-copy / form-row-open and the form-row-menu kebab.
 *   2. form-row-edit navigates to /admin/forms/:id/edit.
 *   3. form-row-connect navigates to /admin/forms/:id/edit?tab=connect (the
 *      editor Connect tab ships from another workstream; the param is
 *      forward-compatible today).
 *   4. form-row-copy flips into a transient copied state (pi-clipboard →
 *      pi-check) within 2s of a successful clipboard write.
 *   5. The kebab menu contains ONLY Duplicate and Delete — the cross-links
 *      moved onto the row.
 *   6. At 375px the secondary buttons collapse to icon-only (labels hidden,
 *      aria-labels retained) and the page never scrolls horizontally.
 */

const API = 'http://localhost:4400';
const ORIGIN = 'http://localhost:3400';

// Per-run counter (Date.now intentionally avoided) keeps names unique per run.
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
  const name = `v3w8-list-${label}-w${workerIndex}-${formSeq}`;
  const res = await request.post(`${API}/v1/forms`, { data: { name, config: baseConfig() } });
  expect(res.status(), 'POST /v1/forms should create the form').toBe(201);
  const body = (await res.json()) as { id: string; slug: string };
  expect(body.id).toBeTruthy();
  expect(body.slug).toBeTruthy();
  return { ...body, name };
}

/** Same derivation the list page uses — never hardcode the account code. */
async function publicPath(request: APIRequestContext, slug: string) {
  const res = await request.get(`${API}/v1/me`);
  expect(res.ok(), 'GET /v1/me should resolve the principal').toBeTruthy();
  const me = (await res.json()) as { accountCode: string; handle: string | null };
  return `/${me.accountCode}/${me.handle ?? 'me'}/${slug}`;
}

/** The list row belonging to one form. Anchored on the form id (via the edit
 *  link href) — names/slugs of prior QA runs can collide, ids cannot. */
function rowFor(page: Page, id: string) {
  return page
    .getByTestId('form-row')
    .filter({ has: page.locator(`a[data-testid="form-row-edit"][href="/admin/forms/${id}/edit"]`) });
}

/** Best-effort clipboard-write grant so the post-copy flip actually fires. */
async function allowClipboard(context: BrowserContext) {
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  } catch {
    /* permission unsupported on this browser — the flip assertion still applies */
  }
}

test.describe('V3 — forms list action rows', () => {
  test('row exposes first-class actions with the expected targets', async ({ page, request }, testInfo) => {
    const form = await createForm(request, 'row', testInfo.workerIndex);
    const expectedPath = await publicPath(request, form.slug);

    await page.goto('/admin/forms');
    const row = rowFor(page, form.id);
    await expect(row, 'the created form renders as a list row').toBeVisible({ timeout: 25_000 });

    // Visible action set, in DOM: Edit / Submissions / Analytics / Connect.
    const edit = row.getByTestId('form-row-edit');
    const submissions = row.getByTestId('form-row-submissions');
    const analytics = row.getByTestId('form-row-analytics');
    const connect = row.getByTestId('form-row-connect');
    await expect(edit).toBeVisible();
    await expect(submissions).toBeVisible();
    await expect(analytics).toBeVisible();
    await expect(connect).toBeVisible();
    await expect(edit).toHaveAttribute('href', `/admin/forms/${form.id}/edit`);
    await expect(submissions).toHaveAttribute('href', `/admin/forms/${form.id}/submissions`);
    await expect(analytics).toHaveAttribute('href', `/admin/forms/${form.id}/analytics`);
    await expect(connect).toHaveAttribute('href', `/admin/forms/${form.id}/edit?tab=connect`);

    // Desktop: secondary buttons show their text labels.
    await expect(submissions.locator('span')).toBeVisible();

    // Icon-only utilities + kebab.
    await expect(row.getByTestId('form-row-copy')).toBeVisible();
    const open = row.getByTestId('form-row-open');
    await expect(open).toBeVisible();
    await expect(open, 'opens the public form in a new tab').toHaveAttribute('target', '_blank');
    await expect(open, 'external open carries noreferrer').toHaveAttribute('rel', /noreferrer/);
    await expect(open, 'href is the form public path').toHaveAttribute('href', expectedPath);
    await expect(row.getByTestId('form-row-menu')).toBeVisible();

    // The public URL shows as subtle text on the row (no more input field).
    await expect(row.getByText(expectedPath)).toBeVisible();
    await expect(row.locator('input')).toHaveCount(0);
  });

  test('Edit navigates to the form editor', async ({ page, request }, testInfo) => {
    const form = await createForm(request, 'edit', testInfo.workerIndex);

    await page.goto('/admin/forms');
    const row = rowFor(page, form.id);
    await expect(row).toBeVisible({ timeout: 25_000 });

    await row.getByTestId('form-row-edit').click();
    await page.waitForURL((url) => url.pathname === `/admin/forms/${form.id}/edit`, { timeout: 25_000 });
  });

  test('Connect navigates to the editor connect tab URL', async ({ page, request }, testInfo) => {
    const form = await createForm(request, 'connect', testInfo.workerIndex);

    await page.goto('/admin/forms');
    const row = rowFor(page, form.id);
    await expect(row).toBeVisible({ timeout: 25_000 });

    await row.getByTestId('form-row-connect').click();
    await page.waitForURL(
      (url) => url.pathname === `/admin/forms/${form.id}/edit` && url.searchParams.get('tab') === 'connect',
      { timeout: 25_000 },
    );
  });

  test('copy button flips to a transient copied state on click', async ({ page, context, request }, testInfo) => {
    await allowClipboard(context);
    const form = await createForm(request, 'copy', testInfo.workerIndex);

    await page.goto('/admin/forms');
    const row = rowFor(page, form.id);
    await expect(row).toBeVisible({ timeout: 25_000 });

    const copyBtn = row.getByTestId('form-row-copy');
    const icon = copyBtn.locator('i');
    await expect(icon, 'starts on the clipboard icon').toHaveClass(/pi-clipboard/);
    await expect(icon).not.toHaveClass(/pi-check/);

    // Click then assert the copied flip, retrying the pair to absorb client
    // hydration timing. Each click re-arms the 2s window, so repeats are safe.
    await expect(async () => {
      await copyBtn.click();
      await expect(icon).toHaveClass(/pi-check/, { timeout: 1_000 });
    }).toPass({ timeout: 12_000 });
  });

  test('kebab menu holds only Duplicate and Delete', async ({ page, request }, testInfo) => {
    const form = await createForm(request, 'menu', testInfo.workerIndex);

    await page.goto('/admin/forms');
    const row = rowFor(page, form.id);
    await expect(row).toBeVisible({ timeout: 25_000 });

    await row.getByTestId('form-row-menu').click();
    const menu = row.getByRole('menu');
    await expect(menu).toBeVisible();

    const items = menu.getByRole('menuitem');
    await expect(items, 'exactly two menu items remain').toHaveCount(2);
    await expect(items.nth(0)).toHaveText(/Duplicate|Duplicar/);
    await expect(items.nth(1)).toHaveText(/Delete|Eliminar/);

    // The old cross-links must be gone from the menu.
    for (const gone of [/Edit|Editar/, /Analytics|Analítica/, /Submissions|Respuestas/, /Integrations|Integraciones/]) {
      await expect(menu.getByRole('menuitem', { name: gone })).toHaveCount(0);
    }
  });
});

test.describe('V3 — forms list at mobile width', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('secondary buttons collapse to icon-only and the row never overflows', async ({ page, request }, testInfo) => {
    const form = await createForm(request, 'mobile', testInfo.workerIndex);

    await page.goto('/admin/forms');
    const row = rowFor(page, form.id);
    await expect(row).toBeVisible({ timeout: 25_000 });

    // Every action is still reachable…
    for (const id of [
      'form-row-edit',
      'form-row-submissions',
      'form-row-analytics',
      'form-row-connect',
      'form-row-copy',
      'form-row-open',
      'form-row-menu',
    ]) {
      await expect(row.getByTestId(id)).toBeVisible();
    }

    // …but secondary labels are hidden below md; accessible names survive.
    for (const id of ['form-row-submissions', 'form-row-analytics', 'form-row-connect']) {
      const btn = row.getByTestId(id);
      await expect(btn.locator('span'), `${id} label collapses at 375px`).toBeHidden();
      const ariaLabel = await btn.getAttribute('aria-label');
      expect(ariaLabel, `${id} keeps an aria-label`).toBeTruthy();
      const title = await btn.getAttribute('title');
      expect(title, `${id} keeps a title tooltip`).toBeTruthy();
    }

    // The page must not scroll horizontally at 375px (rows wrap cleanly).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'no horizontal overflow at 375px').toBeLessThanOrEqual(1);
  });
});
