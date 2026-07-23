import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * V3 — the editor's Connect tab (Typeform parity).
 *
 * The per-form Integrations screen moved INTO the editor as a top-level tab
 * (Build · Logic · Connect · Results · Design) that also hosts the new
 * Tracking & Pixels section (feature N7) and an Emails slot stub:
 *  a. /admin/forms/:id/edit?tab=connect deep-links to the Connect panel (the
 *     Build canvas is not shown), and switching tabs shallow-syncs the URL;
 *  b. the old /admin/forms/:id/integrations route redirects there;
 *  c. a Meta Pixel ID typed into Tracking autosaves into the DRAFT config,
 *     and publishing puts the fbq init snippet on the public page;
 *  d. the Integrations section (existing IntegrationsEditor) loads inside the
 *     tab — HubSpot card with its connected badge (this QA env has a real
 *     account-level HubSpot connection; never disconnect it).
 *
 * Forms are created per test via the admin API (v3w3- slug prefix via the
 * name); unique names use a worker-scoped counter (no Date.now()).
 */

const API = 'http://localhost:4400';
const PIXEL_ID = '111222333444555';

let seq = 0;
function formName(label: string, workerIndex: number): string {
  seq += 1;
  return `v3w3 connect ${label} w${workerIndex}-${seq}`;
}

/** Two question steps + a cover, created as the LIVE config (POST semantics). */
const baseConfig = {
  version: 1,
  cover: { enabled: true, headline: 'Connect tab QA', ctaText: 'Start' },
  steps: [
    { key: 'work_email', type: 'email', question: 'Work email', required: true },
    { key: 'company', type: 'text', question: 'Company name' },
  ],
};

async function getAccountCode(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/v1/me`);
  expect(res.ok(), `GET /v1/me failed: ${res.status()}`).toBeTruthy();
  const me = (await res.json()) as { accountCode: string };
  expect(me.accountCode).toBeTruthy();
  return me.accountCode;
}

async function createForm(
  request: APIRequestContext,
  name: string,
): Promise<{ id: string; slug: string }> {
  const res = await request.post(`${API}/v1/forms`, { data: { name, config: baseConfig } });
  expect(res.ok(), `create form failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string };
  return body;
}

/** Block every non-QA-host request (nothing external may ever load in QA). */
async function blockExternalRequests(page: Page): Promise<string[]> {
  const attempted: string[] = [];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('http://localhost:3400') || url.startsWith('http://localhost:4400')) {
      return route.continue();
    }
    attempted.push(url);
    return route.abort();
  });
  return attempted;
}

test('?tab=connect deep-links to the Connect panel (not Build) and loads Integrations + Tracking + Emails', async ({
  page,
  request,
}, testInfo) => {
  const { id } = await createForm(request, formName('deeplink', testInfo.workerIndex));

  await page.goto(`/admin/forms/${id}/edit?tab=connect`);

  // The Connect panel is the active view…
  await expect(page.getByTestId('connect-panel')).toBeVisible();
  await expect(page.getByTestId('editor-tab-connect')).toHaveAttribute('aria-current', 'true');
  // …and the Build canvas is not (its header line renders only on Build).
  await expect(page.getByText('editing live')).toHaveCount(0);

  // (d) Integrations loaded inside the tab: webhook card + the HubSpot card
  // with the account-level connected badge (auto-waits through the skeleton).
  const integrations = page.getByTestId('connect-integrations');
  await expect(integrations).toBeVisible();
  await expect(integrations.getByText('HubSpot connected')).toBeVisible({ timeout: 15_000 });
  await expect(integrations.getByRole('switch', { name: 'Webhook', exact: true })).toBeVisible();
  await expect(integrations.getByRole('switch', { name: 'HubSpot', exact: true })).toBeVisible();
  // Not the disconnected prompt: no "Go to Connections" link.
  await expect(integrations.getByRole('link', { name: 'Go to Connections' })).toHaveCount(0);

  // Tracking & Pixels inputs are present.
  for (const tid of [
    'tracking-gtm',
    'tracking-meta',
    'tracking-posthog-key',
    'tracking-posthog-host',
    'tracking-hubspot',
  ]) {
    await expect(page.getByTestId(tid)).toBeVisible();
  }

  // Emails section renders (the stub was replaced by the per-form template
  // overrides — deep coverage lives in v3-form-emails.spec.ts).
  await expect(page.getByTestId('connect-emails')).toBeVisible();
});

test('switching tabs shallow-syncs the ?tab query (connect on, removed on build)', async ({
  page,
  request,
}, testInfo) => {
  const { id } = await createForm(request, formName('tabsync', testInfo.workerIndex));

  await page.goto(`/admin/forms/${id}/edit`);
  // Default (no ?tab) → Build: the canvas header line is visible.
  await expect(page.getByText('editing live')).toBeVisible();
  await expect(page.getByTestId('connect-panel')).toHaveCount(0);

  // Click Connect → panel shows and the URL gains ?tab=connect (replaceState).
  await page.getByTestId('editor-tab-connect').click();
  await expect(page.getByTestId('connect-panel')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/admin/forms/${id}/edit\\?tab=connect`));

  // Back to Build → the param is removed (build is the default).
  await page.getByTestId('editor-tab-build').click();
  await expect(page.getByText('editing live')).toBeVisible();
  await expect(page).not.toHaveURL(/tab=connect/);
});

test('the old /admin/forms/:id/integrations route redirects to the Connect tab', async ({
  page,
  request,
}, testInfo) => {
  const { id } = await createForm(request, formName('redirect', testInfo.workerIndex));

  await page.goto(`/admin/forms/${id}/integrations`);

  await expect(page).toHaveURL(new RegExp(`/admin/forms/${id}/edit\\?tab=connect`), {
    timeout: 15_000,
  });
  await expect(page.getByTestId('connect-panel')).toBeVisible();
});

test('Meta Pixel ID set in Tracking autosaves to the draft; publish injects fbq init on the public page', async ({
  page,
  request,
}, testInfo) => {
  const accountCode = await getAccountCode(request);
  const { id, slug } = await createForm(request, formName('pixel', testInfo.workerIndex));

  await page.goto(`/admin/forms/${id}/edit?tab=connect`);
  const meta = page.getByTestId('tracking-meta');
  await expect(meta).toBeVisible();
  await meta.fill(PIXEL_ID);
  await expect(meta).toHaveValue(PIXEL_ID);

  // Autosave (debounced ~0.9s) writes an UNPUBLISHED draft whose
  // config.tracking carries the pixel id; the live config stays untouched.
  await expect
    .poll(
      async () => {
        const res = await request.get(`${API}/v1/forms/${id}`);
        const f = (await res.json()) as {
          config?: { tracking?: { metaPixelId?: string } };
          draftConfig?: { tracking?: { metaPixelId?: string } } | null;
        };
        return f.draftConfig?.tracking?.metaPixelId ?? null;
      },
      { timeout: 15_000, message: 'autosave should stage tracking.metaPixelId in the draft' },
    )
    .toBe(PIXEL_ID);

  // Publish the draft (same endpoint the editor's Publish button calls — the
  // button's label/badge is owned by a parallel redesign, so the API keeps
  // this spec stable). Live config must now carry the tracking id.
  const pub = await request.post(`${API}/v1/forms/${id}/publish`);
  expect(pub.ok(), `publish failed: ${pub.status()}`).toBeTruthy();
  const published = (await pub.json()) as { config?: { tracking?: { metaPixelId?: string } } };
  expect(published.config?.tracking?.metaPixelId).toBe(PIXEL_ID);

  // Public page: the Meta Pixel snippet renders with that id. Block external
  // hosts (the snippet would call connect.facebook.net); assert on the TAG —
  // next/script (afterInteractive) attaches it after hydration and script
  // elements are never "visible", so use attachment + textContent.
  await blockExternalRequests(page);
  await page.goto(`/${accountCode}/me/${slug}`);

  const pixelTag = page.locator('script[data-testid="tracking-meta-pixel"]');
  await expect(pixelTag).toBeAttached({ timeout: 15_000 });
  const snippet = await pixelTag.evaluate((el) => el.textContent ?? '');
  expect(snippet).toContain(`fbq('init',${JSON.stringify(PIXEL_ID)})`);
  expect(snippet).toContain(`fbq('track','PageView')`);

  // The noscript fallback (server-rendered) carries the id too.
  await expect(page.locator('[data-testid="tracking-meta-pixel-noscript"]')).toBeAttached();
});
