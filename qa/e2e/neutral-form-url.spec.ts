import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The public link of a form never names a member.
 *
 * Every link the product hands out is `/{accountCode}/f/{slug}`. The middle
 * segment used to be the handle of whoever was LOOKING at the builder or the
 * forms list, so a link given to a lead, an ad audience or a printed QR named
 * somebody inside the customer's company. Under test:
 *
 *   1. every share surface in the builder (Copy link, Edit link, Embed, QR,
 *      Open form, the preview's address bar, the prefill example) and on the
 *      forms list hands out the neutral link, never the viewer's handle;
 *   2. a link handed out before, with a handle in the middle, keeps serving the
 *      form where it is (200, no redirect) and names the neutral URL as
 *      canonical, while the neutral URL needs no canonical of its own;
 *   3. a published member page, which names its member on purpose, links its
 *      forms at the neutral URL;
 *   4. a form reached at the neutral URL records its partial, its completion
 *      and its funnel events exactly as before: the session key and every API
 *      call carry the account code and the slug, never the middle segment.
 *
 * The other specs still navigate with `/{code}/me/{slug}` on purpose: they are
 * the standing proof that links handed out before this keep working.
 */

const API = 'http://localhost:4400';
const ORIGIN = 'http://localhost:3400';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// better-sqlite3 is not hoisted to the workspace root (pnpm keeps it under
// packages/db): resolve it through the package that depends on it. Readonly
// connections only; this spec writes the QA database through the app alone.
const requireFromDb = createRequire(path.join(REPO_ROOT, 'packages', 'db', 'package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Database: any = requireFromDb('better-sqlite3');
const DB_PATH = path.join(REPO_ROOT, '.data', 'qa.db');

// A per-process nonce (not Date.now, kept out of fixtures by convention) plus a
// per-form counter keep every form name distinct across reruns.
const RUN = randomUUID().slice(0, 8);
let formSeq = 0;

function dbAll<T>(sqlText: string, ...params: unknown[]): T[] {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return db.prepare(sqlText).all(...params) as T[];
  } finally {
    db.close();
  }
}

/** The principal the local auth stub resolves: its account code and handle. */
async function whoAmI(request: APIRequestContext) {
  const res = await request.get(`${API}/v1/me`);
  expect(res.ok(), 'GET /v1/me should resolve the principal').toBeTruthy();
  const me = (await res.json()) as { accountCode: string; handle: string | null };
  // Every member gets a handle at creation; without one there is nothing this
  // spec could catch leaking.
  expect(me.handle, 'the principal has a handle').toBeTruthy();
  return me as { accountCode: string; handle: string };
}

async function createForm(request: APIRequestContext, label: string, extra: Record<string, unknown> = {}) {
  formSeq += 1;
  const name = `qa-neutral-url-${label}-${RUN}-${formSeq}`;
  const res = await request.post(`${API}/v1/forms`, {
    data: {
      name,
      config: {
        version: 1,
        cover: { enabled: false },
        steps: [
          { key: 'q1', type: 'text', question: 'Your name?', required: true },
          { key: 'q2', type: 'email', question: 'Work email?', required: true },
        ],
        ...extra,
      },
    },
  });
  expect(res.status(), 'POST /v1/forms should create the form').toBe(201);
  return (await res.json()) as { id: string; slug: string };
}

/** Best-effort clipboard grant, so a copy can be read back. */
async function allowClipboard(context: BrowserContext) {
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  } catch {
    /* unsupported on this browser: the clipboard assertions will say so */
  }
}

/**
 * What a copy button put on the clipboard. The clipboard is emptied first, so a
 * value left by an earlier copy can never pass for this one, and the click is
 * retried until hydration has wired the button.
 */
async function copied(page: Page, button: ReturnType<Page['getByTestId']>): Promise<string> {
  let text = '';
  await expect(async () => {
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await button.click();
    text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).not.toBe('');
  }).toPass({ timeout: 12_000 });
  return text;
}

/** The href of the page's canonical tag, or undefined when it has none. */
function canonicalOf(html: string): string | undefined {
  return html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
}

/** The list row belonging to one form, anchored on its id (slugs of older runs can collide). */
function rowFor(page: Page, id: string) {
  return page
    .getByTestId('form-row')
    .filter({ has: page.locator(`a[data-testid="form-row-edit"][href="/admin/forms/${id}/edit"]`) });
}

test.describe('Neutral public form URL', () => {
  test('the builder and the forms list hand out the neutral link, never the handle', async ({
    page,
    context,
    request,
  }) => {
    test.setTimeout(90_000);
    await allowClipboard(context);
    const me = await whoAmI(request);
    const form = await createForm(request, 'share');
    const neutralPath = `/${me.accountCode}/f/${form.slug}`;
    const neutralUrl = `${ORIGIN}${neutralPath}`;
    // Text a surface handed out that is asserted by containment rather than
    // equality; each one is also checked for the handle at the end.
    const handedOut: string[] = [];

    await page.goto(`/admin/forms/${form.id}/edit`);

    // Open form.
    await expect(page.locator('a[data-testid="editor-open-form"]')).toHaveAttribute('href', neutralPath, {
      timeout: 25_000,
    });

    // Copy link.
    expect(await copied(page, page.getByTestId('editor-copy-link'))).toBe(neutralUrl);

    // Embed: the iframe's src.
    await page.getByTestId('editor-embed').click();
    const snippet = page.getByTestId('embed-snippet');
    await expect(snippet).toContainText(`src="${neutralUrl}?embed=1"`);
    handedOut.push(await snippet.innerText());
    await page.keyboard.press('Escape');
    await expect(snippet).toBeHidden();

    // QR: the URL the code encodes.
    await page.getByTestId('editor-qr').click();
    await expect(page.getByTestId('qr-url')).toHaveText(neutralUrl);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('qr-url')).toBeHidden();

    // Edit link: the fixed part it shows in front of the editable slug.
    await page.getByTestId('editor-rename-link').click();
    const slugInput = page.getByTestId('form-slug-input');
    await expect(slugInput).toHaveValue(form.slug);
    await expect(slugInput.locator('xpath=preceding-sibling::span')).toHaveText(
      `${new URL(ORIGIN).host}/${me.accountCode}/f/`,
    );
    await page.keyboard.press('Escape');
    await expect(slugInput).toBeHidden();

    // The prefill example in the selected question's Advanced settings. The
    // group opens on its own when the step already has an advanced setting, so
    // it is toggled only while closed: a blind click would collapse it.
    const advancedHeader = page.getByTestId('advanced-settings').getByRole('button', { name: /Advanced/ });
    if ((await advancedHeader.getAttribute('aria-expanded')) !== 'true') await advancedHeader.click();
    await expect(advancedHeader).toHaveAttribute('aria-expanded', 'true');
    const prefill = page.getByTestId('prefill-row').locator('code');
    await expect(prefill).toContainText(`${neutralPath}?q1=`);
    handedOut.push(await prefill.innerText());

    // Design: the preview's address bar, its copy button and its open link.
    await page.getByTestId('editor-tab-design').click();
    const previewCopy = page.getByTestId('preview-copy-link');
    const addressBar = previewCopy.locator('..');
    await expect(addressBar.locator(`[title="${neutralUrl}"]`)).toBeVisible({ timeout: 15_000 });
    await expect(addressBar.locator('a[target="_blank"]')).toHaveAttribute('href', neutralPath);
    expect(await copied(page, previewCopy)).toBe(neutralUrl);

    // The forms list: the path on the row, Open and Copy.
    await page.goto('/admin/forms');
    const row = rowFor(page, form.id);
    await expect(row).toBeVisible({ timeout: 25_000 });
    await expect(row.getByText(neutralPath, { exact: true })).toBeVisible();
    await expect(row.getByTestId('form-row-open')).toHaveAttribute('href', neutralPath);
    expect(await copied(page, row.getByTestId('form-row-copy'))).toBe(neutralUrl);

    for (const text of handedOut) {
      expect(text, 'no surface names the member').not.toContain(`/${me.handle}/`);
    }
  });

  test('an old link naming a member keeps serving the form, with the neutral URL as canonical', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const me = await whoAmI(request);
    const form = await createForm(request, 'named');
    const neutralPath = `/${me.accountCode}/f/${form.slug}`;
    const namedPath = `/${me.accountCode}/${me.handle}/${form.slug}`;

    // No browser: what a crawler, a link checker or a social unfurler gets.
    const named = await request.get(`${ORIGIN}${namedPath}?utm_source=qa`);
    expect(named.status(), 'the old link still answers 200').toBe(200);
    const namedHtml = await named.text();
    const canonical = canonicalOf(namedHtml);
    expect(canonical, 'the old link names a canonical URL').toBeTruthy();
    expect(new URL(canonical!, ORIGIN).pathname, 'and it is the neutral one').toBe(neutralPath);
    expect(canonical, 'with no campaign parameters on it').not.toContain('utm_');
    expect(namedHtml, 'served where it is: no redirect of any kind').not.toContain('http-equiv="refresh"');

    const neutral = await request.get(`${ORIGIN}${neutralPath}`);
    expect(neutral.status()).toBe(200);
    expect(canonicalOf(await neutral.text()), 'the neutral URL is already the canonical one').toBeUndefined();

    // In a browser, both addresses render the form and it works (a hydrated
    // renderer walks to the next question), and the old one stays put.
    const crashes: string[] = [];
    page.on('pageerror', (err) => crashes.push(err.message));
    for (const at of [namedPath, neutralPath]) {
      await page.goto(`${at}?utm_source=qa`);
      await expect(page.locator('.pf__question')).toHaveText('Your name?', { timeout: 20_000 });
      await expect(async () => {
        await page.locator('input[type="text"]').fill('Alex');
        await page.locator('.pf__btn--inline').first().click();
        await expect(page.locator('.pf__question')).toHaveText('Work email?', { timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      expect(new URL(page.url()).pathname, 'no redirect moved the visitor').toBe(at);
    }
    expect(crashes, 'no uncaught error on either address').toEqual([]);
  });

  test('a published member page links its forms at the neutral URL', async ({ page, request }) => {
    const me = await whoAmI(request);
    const form = await createForm(request, 'profile');
    const neutralPath = `/${me.accountCode}/f/${form.slug}`;

    const before = await request.get(`${API}/v1/me/profile`);
    expect(before.ok(), `GET /v1/me/profile ${before.status()}`).toBeTruthy();
    const original = (await before.json()) as { profile: unknown };

    try {
      const published = await request.put(`${API}/v1/me/profile`, {
        data: { profile: { version: 1, enabled: true, formSlugs: [form.slug] } },
      });
      expect(published.ok(), `PUT /v1/me/profile ${published.status()}`).toBeTruthy();

      // The page itself is personal on purpose and keeps the handle.
      await page.goto(`/${me.accountCode}/${me.handle}`);
      const profile = page.getByTestId('member-profile');
      await expect(profile).toBeVisible({ timeout: 20_000 });
      const link = profile.locator(`a[href="${neutralPath}"]`);
      await expect(link, 'the form is linked at the neutral URL').toBeVisible();
      await expect(profile.locator(`a[href^="/${me.accountCode}/${me.handle}/"]`)).toHaveCount(0);

      await link.click();
      await page.waitForURL(`${ORIGIN}${neutralPath}`, { timeout: 20_000 });
      await expect(page.locator('.pf__question')).toHaveText('Your name?', { timeout: 20_000 });
    } finally {
      const restored = await request.put(`${API}/v1/me/profile`, {
        data: { profile: original.profile ?? null },
      });
      expect(restored.ok(), 'the original profile is restored').toBeTruthy();
    }
  });

  test('a form reached at the neutral URL records its partial, completion and events as before', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const me = await whoAmI(request);
    // 1-based over `steps`: a partial fires once the first answer is in.
    const form = await createForm(request, 'submit', { partialSubmitAfterStep: 1 });

    await page.goto(`/${me.accountCode}/f/${form.slug}`);
    await expect(page.locator('.pf__question')).toHaveText('Your name?', { timeout: 20_000 });
    // The respondent's session is keyed by account code and slug, never by the
    // middle segment, so nobody loses progress between the two link shapes.
    const sessionId = await page.evaluate(
      (key) => window.sessionStorage.getItem(key),
      `quill-form-${me.accountCode}-${form.slug}`,
    );
    expect(sessionId, 'the renderer minted a session').toBeTruthy();

    await expect(async () => {
      await page.locator('input[type="text"]').fill('Alex');
      await page.locator('.pf__btn--inline').first().click();
      await expect(page.locator('.pf__question')).toHaveText('Work email?', { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });

    type Row = { id: string; partial_at: number | null; completed_at: number | null };
    const rowOf = () =>
      dbAll<Row>(
        'SELECT id, partial_at, completed_at FROM submission WHERE form_id = ? AND session_id = ?',
        form.id,
        sessionId,
      )[0];
    await expect
      .poll(() => rowOf()?.partial_at ?? null, { message: 'the partial landed', timeout: 15_000 })
      .not.toBeNull();
    const partial = rowOf()!;
    expect(partial.completed_at).toBeNull();

    await page.locator('input[type="email"]').fill(`qa-neutral-${RUN}@example.com`);
    await page.locator('.pf__btn--inline').first().click();
    await expect(page.locator('.pf-done__title')).toBeVisible({ timeout: 20_000 });

    await expect
      .poll(() => rowOf()?.completed_at ?? null, { message: 'the completion landed', timeout: 15_000 })
      .not.toBeNull();
    expect(rowOf()!.id, 'the partial upgraded in place').toBe(partial.id);

    await expect
      .poll(
        () =>
          dbAll<{ type: string }>(
            'SELECT DISTINCT type FROM form_event WHERE form_id = ? AND session_id = ?',
            form.id,
            sessionId,
          )
            .map((r) => r.type)
            .sort(),
        { message: 'the funnel events landed', timeout: 15_000 },
      )
      .toEqual(expect.arrayContaining(['partial_submit', 'step_complete', 'submit', 'view']));
  });
});
