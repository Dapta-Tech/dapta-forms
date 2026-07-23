import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * V3 — the promo banner (`cover.bannerText`) is PINNED to the top of the
 * viewport, full-width, in EVERY phase and at every viewport size.
 *
 * The bug: the banner was a direct child of `.pf` (a flex column), and the
 * desktop media block applied `justify-content: center` to `.pf` per phase —
 * so the whole {banner + card} group centered vertically and the banner
 * floated mid-page. The fix renders the banner once (PhaseShell in
 * form-renderer.tsx) and wraps everything else in `.pf__main`, which now owns
 * the centering, so the banner can never leave the viewport top.
 *
 * Assertions (black-box, on `.pf__banner`'s viewport-relative boundingBox):
 *   y === 0 (±1px) and x === 0 (±1px), and the width spans the full viewport
 *   (documentElement.clientWidth, i.e. viewport minus any classic scrollbar),
 *   at BOTH 1280x800 (desktop) and 375x812 (mobile), in the cover phase, the
 *   steps phase (after Start), and the done phase (after submit).
 *
 * Each test creates its own live form via the admin API (:4400) — the config
 * in the initial POST /v1/forms IS the published/live config (create writes
 * live config, per qa/QA-CONTEXT.md). accountCode comes from GET /v1/me.
 */

const API = 'http://localhost:4400';
const BANNER = '50% de descuento';

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(here, '..', 'shots');

/** Per-run form counter — keeps names distinct without Date.now. */
let formSeq = 0;

/**
 * Create + publish (create writes LIVE config) a banner-carrying form:
 * cover screen (headline + Start CTA + bannerText) and one auto-advancing
 * single-select question, with a no-redirect outcome so submit lands on the
 * done screen. Returns the public path `/<accountCode>/me/<slug>`.
 */
async function createForm(request: APIRequestContext, label: string): Promise<string> {
  formSeq += 1;
  const name = `v3w2-banner-top-${label}-w${test.info().workerIndex}-${formSeq}`;
  const config = {
    version: 1,
    cover: {
      enabled: true,
      headline: 'Find the right plan',
      subheadline: 'Two clicks, no typing.',
      ctaText: 'Start',
      bannerText: BANNER,
    },
    steps: [
      {
        key: 'pick',
        type: 'multiple_choice',
        question: 'Pick one to finish',
        options: [
          { label: 'Option A', value: 'a', points: 1 },
          { label: 'Option B', value: 'b', points: 0 },
        ],
      },
    ],
    scoring: { enabled: true },
    outcomes: [{ id: 'p1', label: 'Thanks!', minScore: -100 }],
  };

  const me = await request.get(`${API}/v1/me`);
  expect(me.ok(), `GET /v1/me failed: ${me.status()}`).toBeTruthy();
  const { accountCode } = (await me.json()) as { accountCode: string };

  const res = await request.post(`${API}/v1/forms`, { data: { name, config } });
  expect(res.ok(), `form creation failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { slug: string };
  return `/${accountCode}/me/${body.slug}`;
}

/** Never let a test reach a third-party host (these forms need none). */
async function blockExternal(page: Page): Promise<void> {
  await page.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return route.continue();
    return route.abort();
  });
}

/**
 * Open the public form until the cover renders. The public API is
 * rate-limited per IP (a token bucket SHARED across concurrently running QA
 * specs); a drained bucket 429s and the server component renders not-found.
 * Reload (tokens refill at 1/s) rather than failing on a transient 429.
 */
async function openForm(page: Page, path: string): Promise<void> {
  await page.goto(path);
  const start = page.getByRole('button', { name: 'Start' });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const visible = await start
      .waitFor({ state: 'visible', timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    if (visible) return;
    await page.waitForTimeout(1_500);
    await page.reload();
  }
  await expect(start).toBeVisible();
}

/**
 * The banner is pinned to the top-left of the VIEWPORT (boundingBox is
 * viewport-relative) and spans its full width.
 */
async function expectBannerPinned(page: Page, where: string): Promise<void> {
  const banner = page.locator('.pf__banner');
  await expect(banner, `${where}: banner visible`).toBeVisible();
  await expect(banner, `${where}: banner text`).toHaveText(BANNER);

  const box = await banner.boundingBox();
  expect(box, `${where}: banner has a bounding box`).not.toBeNull();
  expect(Math.abs(box!.y), `${where}: banner top must be y=0 (got ${box!.y})`).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.x), `${where}: banner left must be x=0 (got ${box!.x})`).toBeLessThanOrEqual(1);

  // Full-bleed width: equals the layout viewport (clientWidth excludes any
  // classic scrollbar) and, belt-and-braces, is never meaningfully narrower
  // than the configured viewport.
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(
    Math.abs(box!.width - clientWidth),
    `${where}: banner width ${box!.width} must span clientWidth ${clientWidth}`,
  ).toBeLessThanOrEqual(1);
  const viewport = page.viewportSize();
  expect(box!.width, `${where}: banner width vs viewport ${viewport!.width}`).toBeGreaterThanOrEqual(
    viewport!.width - 20,
  );
}

test('banner pinned to viewport top in cover, steps, and done — at 1280x800 and 375x812', async ({
  page,
  request,
}) => {
  await blockExternal(page);
  const path = await createForm(request, 'phases');

  // ── Cover phase ──
  await page.setViewportSize({ width: 1280, height: 800 });
  await openForm(page, path);
  await expectBannerPinned(page, 'cover@1280x800');
  await page.setViewportSize({ width: 375, height: 812 });
  await expectBannerPinned(page, 'cover@375x812');

  // ── Steps phase ──
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('.pf__question')).toHaveText('Pick one to finish');
  await expectBannerPinned(page, 'steps@1280x800');
  await page.setViewportSize({ width: 375, height: 812 });
  await expectBannerPinned(page, 'steps@375x812');

  // ── Done phase — the single-select auto-advances (options render with
  // role="radio"); it is the only step, so selecting submits
  // (submitting interstitial → done screen). ──
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('radio', { name: 'Option A' }).click();
  await expect(page.locator('.pf-done__title')).toHaveText('Thanks!');
  await expectBannerPinned(page, 'done@1280x800');
  await page.setViewportSize({ width: 375, height: 812 });
  await expectBannerPinned(page, 'done@375x812');
});

test('screenshot — steps phase at 1440x900 (qa/shots/v3-banner-top.png)', async ({
  page,
  request,
}) => {
  await blockExternal(page);
  const path = await createForm(request, 'shot');

  await page.setViewportSize({ width: 1440, height: 900 });
  await openForm(page, path);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('.pf__question')).toHaveText('Pick one to finish');
  await expectBannerPinned(page, 'steps@1440x900');

  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: resolve(SHOTS, 'v3-banner-top.png'), fullPage: false });
});
