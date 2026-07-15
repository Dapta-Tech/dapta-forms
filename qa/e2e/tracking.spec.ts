import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

/**
 * Third-party tracking wrappers (GTM / Meta Pixel / PostHog / HubSpot) must
 * render on PUBLIC form pages only, driven by config.tracking:
 *  1. a form WITH tracking ids renders all four script tags (testids);
 *  2. a form WITHOUT tracking renders none of them and attempts zero requests
 *     to the tracker hosts;
 *  3. admin pages never render tracking testids.
 *
 * All external hosts are blocked via page.route so nothing real ever loads —
 * assertions are on script TAG presence (next/script `afterInteractive`
 * injects the tags client-side after hydration, so we use attachment waits,
 * not visibility: script elements are never "visible").
 */

const API = 'http://localhost:4400';

/** Hosts the four tracking snippets would call if not blocked. */
const TRACKER_HOSTS =
  /googletagmanager\.com|connect\.facebook\.net|facebook\.com|posthog\.com|hs-scripts\.com|hubspot/i;

const TRACKING_TESTIDS = [
  'tracking-gtm',
  'tracking-meta-pixel',
  'tracking-posthog',
  'tracking-hubspot',
] as const;

/**
 * Block every non-QA-host request and record what was attempted. Returns the
 * (live) list of blocked external URLs so tests can assert on attempts.
 */
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

/** The principal's public account code (QA seed uses a generated short code). */
async function getAccountCode(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/v1/me`);
  expect(res.ok(), 'GET /v1/me should succeed on the QA API').toBeTruthy();
  const me = (await res.json()) as { accountCode: string };
  expect(me.accountCode).toBeTruthy();
  return me.accountCode;
}

/** Create a fresh form via the admin API (live config on create). */
async function createForm(
  request: APIRequestContext,
  name: string,
  tracking: Record<string, string> | undefined,
): Promise<{ slug: string }> {
  const config: Record<string, unknown> = {
    version: 1,
    cover: { enabled: true, headline: 'Tracking QA', ctaText: 'Start' },
    steps: [{ key: 'email', type: 'email', question: 'Your email?', required: true }],
  };
  if (tracking) config.tracking = tracking;
  const res = await request.post(`${API}/v1/forms`, { data: { name, config } });
  expect(res.ok(), `POST /v1/forms should succeed (got ${res.status()})`).toBeTruthy();
  const body = (await res.json()) as { slug: string };
  expect(body.slug).toBeTruthy();
  return body;
}

test('public page WITH config.tracking renders all four tracking script tags', async ({
  page,
  request,
}) => {
  const accountCode = await getAccountCode(request);
  const { slug } = await createForm(request, `qa-tracking-on-${Date.now()}`, {
    gtmId: 'GTM-QA1',
    metaPixelId: '111',
    posthogKey: 'phc_qa',
    hubspotTrackingId: '222',
  });

  await blockExternalRequests(page);
  await page.goto(`/${accountCode}/me/${slug}`);

  // next/script (afterInteractive) injects the tags after hydration — wait for
  // DOM attachment (script tags are never visible).
  for (const testid of TRACKING_TESTIDS) {
    await expect(
      page.locator(`[data-testid="${testid}"]`),
      `expected a <script data-testid="${testid}"> tag on the public page`,
    ).toBeAttached({ timeout: 15_000 });
  }

  // The GTM noscript fallback is server-rendered alongside the script tag.
  await expect(page.locator('[data-testid="tracking-gtm-noscript"]')).toBeAttached();
});

test('public page WITHOUT tracking config renders no tracking tags and attempts no tracker requests', async ({
  page,
  request,
}) => {
  const accountCode = await getAccountCode(request);
  const { slug } = await createForm(request, `qa-tracking-off-${Date.now()}`, undefined);

  const attempted = await blockExternalRequests(page);
  await page.goto(`/${accountCode}/me/${slug}`);

  // Wait until the client island hydrated (cover CTA is interactive), then a
  // grace period for any late afterInteractive injection.
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1_500);

  await expect(page.locator('[data-testid^="tracking-"]')).toHaveCount(0);

  const trackerHits = attempted.filter((url) => TRACKER_HOSTS.test(url));
  expect(trackerHits, 'no requests may be attempted to tracker hosts').toEqual([]);
});

test('admin pages never render tracking testids', async ({ page }) => {
  const attempted = await blockExternalRequests(page);
  await page.goto('/admin/forms');

  // The forms list heading proves the page rendered.
  await expect(page.getByRole('heading', { name: 'Forms' })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1_000);

  await expect(page.locator('[data-testid^="tracking-"]')).toHaveCount(0);

  const trackerHits = attempted.filter((url) => TRACKER_HOSTS.test(url));
  expect(trackerHits, 'admin must not attempt tracker requests').toEqual([]);
});
