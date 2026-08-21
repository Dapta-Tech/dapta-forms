import { randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * V9 — renaming a form's public link, end to end.
 *
 * Under test: the pencil beside Copy link in the builder topbar
 * (apps/web/app/admin/forms/[id]/edit/link-actions.tsx), the rename it performs
 * (PUT /v1/forms/:id/slug), and the two consequences that only show up once all
 * the layers are stacked:
 *
 *   1. the topbar retargets WITHOUT a reload. `publicPath` reaches four client
 *      components as a prop from a server component, so a rename that only
 *      revalidated on the server would leave Copy link, Embed and Open form
 *      pointing at the previous URL for the rest of the session, starting with
 *      the button the author is most likely to press next;
 *   2. the retired URL still lands the visitor on the current one, WITH its
 *      query string intact. The redirect is ours, and dropping the query on our
 *      own redirect is exactly how campaign attribution was lost once before,
 *      so `?utm_source` is asserted rather than assumed. Next resolves this
 *      redirect on the client, so the crawler's half of it (the canonical tag)
 *      is asserted separately, without a browser.
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
    steps: [{ key: 'q1', type: 'text', question: 'Your name?' }],
  };
}

async function createForm(request: APIRequestContext, label: string, workerIndex: number) {
  formSeq += 1;
  const name = `qa-slug-rename-${label}-w${workerIndex}-${formSeq}`;
  const res = await request.post(`${API}/v1/forms`, { data: { name, config: baseConfig() } });
  expect(res.status(), 'POST /v1/forms should create the form').toBe(201);
  const body = (await res.json()) as { id: string; slug: string };
  // Publishing is what puts the form on the public path the redirect assertions use.
  await request.post(`${API}/v1/forms/${body.id}/publish`);
  return body;
}

/** Same derivation the editor page uses — never hardcode the account code. */
async function publicPrefix(request: APIRequestContext) {
  const res = await request.get(`${API}/v1/me`);
  expect(res.ok(), 'GET /v1/me should resolve the principal').toBeTruthy();
  const me = (await res.json()) as { accountCode: string; handle: string | null };
  return `/${me.accountCode}/${me.handle ?? 'me'}`;
}

/**
 * A slug no previous run can already be holding.
 *
 * The per-run counter that names the FORMS is not enough here, and the
 * difference is worth stating because it bit: a form is created by NAME, so a
 * repeat name just gets auto-suffixed and the run carries on. A rename asks for
 * one exact slug. The QA database survives between runs, so a counter that
 * restarts at 1 asks the second run for a slug the first run already took, and
 * the rename correctly refuses it. Random, not `Date.now()`, per the harness
 * convention of keeping wall-clock time out of fixtures.
 */
function freshSlug(label: string, workerIndex: number) {
  return `qa-renamed-${label}-w${workerIndex}-${randomUUID().slice(0, 8)}`;
}

test.describe('V9 — rename a form public link', () => {
  test('the dialog renames the form and the topbar retargets without a reload', async ({
    page,
    request,
  }, testInfo) => {
    const form = await createForm(request, 'topbar', testInfo.workerIndex);
    const prefix = await publicPrefix(request);
    const next = freshSlug('topbar', testInfo.workerIndex);

    await page.goto(`/admin/forms/${form.id}/edit`);

    const openForm = page.locator('a[data-testid="editor-open-form"]');
    await expect(openForm).toHaveAttribute('href', `${prefix}/${form.slug}`, { timeout: 25_000 });

    await page.getByTestId('editor-rename-link').click();
    const input = page.getByTestId('form-slug-input');
    await expect(input).toBeVisible();
    await expect(input, 'the dialog opens on the current slug').toHaveValue(form.slug);

    await input.fill(next);
    await page.getByTestId('form-slug-save').click();

    // No navigation, no reload: the same DOM node now points at the new URL.
    await expect(input, 'the dialog closes on success').toBeHidden({ timeout: 15_000 });
    await expect(openForm, 'the topbar follows the rename in place').toHaveAttribute(
      'href',
      `${prefix}/${next}`,
    );

    const server = await request.get(`${API}/v1/forms/${form.id}`);
    expect(((await server.json()) as { slug: string }).slug).toBe(next);
  });

  test('the previous link sends the visitor to the new one, query string intact', async ({
    page,
    request,
  }, testInfo) => {
    const form = await createForm(request, 'redirect', testInfo.workerIndex);
    const prefix = await publicPrefix(request);
    const next = freshSlug('redirect', testInfo.workerIndex);

    const renamed = await request.put(`${API}/v1/forms/${form.id}/slug`, { data: { slug: next } });
    expect(renamed.ok(), 'PUT /v1/forms/:id/slug should rename').toBeTruthy();

    // The retired link, exactly as a campaign email would carry it.
    await page.goto(`${prefix}/${form.slug}?utm_source=qa&utm_medium=email&lang=en`);

    // Waited for, not asserted outright: Next resolves this redirect on the
    // client (see the note in the public page's `generateMetadata`), so the
    // address bar changes a beat after load rather than during it.
    await page.waitForURL(`${ORIGIN}${prefix}/${next}?utm_source=qa&utm_medium=email&lang=en`, {
      timeout: 15_000,
    });
    // The query survived the hop. Losing it here is not hypothetical: the
    // platform has already lost campaign attribution once to one of its own
    // redirects, and `?embed=1` and `?step=N` ride the same path.
    expect(new URL(page.url()).searchParams.get('utm_source')).toBe('qa');
    // The form, not a 404: the alias resolved and the redirect carried through.
    await expect(page.locator('.pf')).toBeVisible({ timeout: 15_000 });
  });

  test('the retired link names the canonical URL for anything that does not run scripts', async ({
    request,
  }, testInfo) => {
    const form = await createForm(request, 'canonical', testInfo.workerIndex);
    const prefix = await publicPrefix(request);
    const next = freshSlug('canonical', testInfo.workerIndex);
    await request.put(`${API}/v1/forms/${form.id}/slug`, { data: { slug: next } });

    // No browser: a crawler, a link checker or a social unfurler reading the
    // markup of the retired URL. The canonical tag is the only thing telling
    // them which address is the real one.
    const res = await request.get(`${ORIGIN}${prefix}/${form.slug}?utm_source=qa`);
    const html = await res.text();
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];

    expect(canonical, 'points at the current slug').toContain(`${prefix}/${next}`);
    expect(canonical, 'and carries no campaign parameters').not.toContain('utm_');
  });

  test('refuses a slug another form already holds, and says so', async ({ page, request }, testInfo) => {
    const taken = await createForm(request, 'taken', testInfo.workerIndex);
    const form = await createForm(request, 'clash', testInfo.workerIndex);

    await page.goto(`/admin/forms/${form.id}/edit`);
    await page.getByTestId('editor-rename-link').click();
    await page.getByTestId('form-slug-input').fill(taken.slug);
    await page.getByTestId('form-slug-save').click();

    await expect(page.getByTestId('form-slug-error'), 'the clash is named on screen').toBeVisible({
      timeout: 15_000,
    });
    // The dialog stays open on a refusal so the typed value is still there to fix.
    await expect(page.getByTestId('form-slug-input')).toBeVisible();

    const server = await request.get(`${API}/v1/forms/${form.id}`);
    expect(((await server.json()) as { slug: string }).slug).toBe(form.slug);
  });

  test('a malformed slug cannot be submitted at all', async ({ page, request }, testInfo) => {
    const form = await createForm(request, 'shape', testInfo.workerIndex);

    await page.goto(`/admin/forms/${form.id}/edit`);
    await page.getByTestId('editor-rename-link').click();
    await page.getByTestId('form-slug-input').fill('Not A Slug');

    // Caught in the browser by the same validator the server runs, so the
    // refusal costs no round trip.
    await expect(page.getByTestId('form-slug-error')).toBeVisible();
    await expect(page.getByTestId('form-slug-save')).toBeDisabled();
  });
});
