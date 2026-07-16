import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Core smoke: a published form renders publicly and the QA API instance is
 * healthy. Full user-flow regression (qualified/disqualified/personal-email
 * walks of the imported pilot form) lives in suite-regression.spec.ts.
 *
 * The seeded `/acme/alex-rivera/lead-qualifier` demo form no longer exists on
 * this shared QA DB (deleted by an earlier session — env data, not code), so
 * this spec creates its OWN disposable published form (slug prefix `v3w12-`)
 * under the principal account resolved from GET /v1/me, asserts the public
 * render, and deletes it afterwards. POST /v1/forms writes LIVE config, so no
 * publish step is needed.
 */

const API = 'http://localhost:4400';

const smokeConfig = {
  version: 1,
  cover: { enabled: true, headline: 'QA core smoke', ctaText: 'Start' },
  steps: [
    { key: 'email', type: 'email', question: 'Your email', required: true },
    { key: 'notes', type: 'text', question: 'Anything else?' },
  ],
};

// Per-run unique names via a worker-scoped counter (no Date.now()).
let seq = 0;
const createdIds: string[] = [];

test.afterAll(async ({ request }) => {
  // DELETE is idempotent (204 when already gone) — leave no junk behind.
  for (const id of createdIds) await request.delete(`${API}/v1/forms/${id}`);
});

async function createSmokeForm(
  request: APIRequestContext,
  workerIndex: number,
): Promise<{ id: string; slug: string; publicPath: string }> {
  seq += 1;
  const meRes = await request.get(`${API}/v1/me`);
  expect(meRes.ok(), `GET /v1/me failed: ${meRes.status()}`).toBeTruthy();
  const me = (await meRes.json()) as { accountCode: string; handle?: string };

  const res = await request.post(`${API}/v1/forms`, {
    data: { name: `v3w12 core smoke w${workerIndex}-${seq}`, config: smokeConfig },
  });
  expect(res.ok(), `POST /v1/forms failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string };
  expect(body.slug.startsWith('v3w12-'), `slug ${body.slug} must be v3w12- prefixed`).toBeTruthy();
  createdIds.push(body.id);
  return {
    id: body.id,
    slug: body.slug,
    publicPath: `/${me.accountCode}/${me.handle ?? 'me'}/${body.slug}`,
  };
}

test('a published form renders its cover and starts', async ({ page, request }, testInfo) => {
  const form = await createSmokeForm(request, testInfo.workerIndex);

  // The shared QA API rate-limits the public surface per IP — the SSR config
  // fetch can transiently 429 and render the not-found page. Back off and
  // reload instead of failing the smoke on an environmental throttle.
  const cta = page.getByRole('button', { name: 'Start', exact: true });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.goto(form.publicPath);
    try {
      await expect(cta).toBeVisible({ timeout: 5_000 });
      break;
    } catch {
      await page.waitForTimeout(5_000); // let the rate-limit bucket refill
    }
  }
  await expect(cta).toBeVisible();
  await cta.click();
  await expect(page.locator('.pf__question').first()).toBeVisible();
  await expect(page.locator('.pf__topbar')).toBeVisible();
});

test('api health is up on the QA instance (sqlite)', async ({ request }) => {
  const res = await request.get(`${API}/health`);
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).dialect).toBe('sqlite');
});
