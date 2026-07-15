import { test, expect } from '@playwright/test';

/**
 * Core smoke: the seeded demo form still renders and the QA API instance is
 * healthy. Full user-flow regression (qualified/disqualified/personal-email
 * walks of the imported pilot form) lives in suite-regression.spec.ts.
 */

const DEMO_PATH = '/acme/alex-rivera/lead-qualifier';
const API = 'http://localhost:4400';

test('demo form renders its cover and starts', async ({ page }) => {
  await page.goto(DEMO_PATH);
  const cta = page.locator('.pf__btn').first();
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
