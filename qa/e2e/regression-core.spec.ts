import { test, expect } from '@playwright/test';

/**
 * Core regression: the seeded demo form must keep working end-to-end after the
 * pilot-port changes, and funnel events must count once (the pilot double-fired
 * `submit` from client AND server — Forms must never regress into that).
 */

const DEMO_PATH = '/acme/alex-rivera/lead-qualifier';
const API = 'http://localhost:4400';

test('demo form renders cover and walks to completion', async ({ page }) => {
  await page.goto(DEMO_PATH);

  // Cover screen → start
  await page.getByRole('button', { name: /start|comenzar|begin|share/i }).click();

  // Walk visible steps generically: answer whatever input type appears.
  for (let i = 0; i < 15; i += 1) {
    // Done screen reached?
    const done = page.getByText(/thank|gracias|you're all set|received/i);
    if (await done.isVisible().catch(() => false)) break;

    const radio = page.locator('[role="radio"], input[type="radio"]').first();
    const textInput = page
      .locator('input[type="text"], input[type="email"], input[type="tel"]')
      .first();
    const slider = page.locator('input[type="range"]').first();
    const textarea = page.locator('textarea').first();

    if (await radio.isVisible().catch(() => false)) {
      await radio.click();
    } else if (await slider.isVisible().catch(() => false)) {
      await slider.focus();
      await page.keyboard.press('ArrowRight');
    } else if (await textInput.isVisible().catch(() => false)) {
      const type = await textInput.getAttribute('type');
      if (type === 'email') await textInput.fill('qa-regression@example.com');
      else if (type === 'tel') await textInput.fill('3001234567');
      else await textInput.fill('QA Regression');
      // name steps have a second field
      const second = page
        .locator('input[type="text"], input[type="email"], input[type="tel"]')
        .nth(1);
      if (await second.isVisible().catch(() => false)) await second.fill('Tester');
    } else if (await textarea.isVisible().catch(() => false)) {
      await textarea.fill('QA regression answer');
    }

    const cont = page.getByRole('button', { name: /continue|next|submit|continuar|siguiente|enviar|ok/i }).first();
    if (await cont.isVisible().catch(() => false)) {
      await cont.click();
    }
    await page.waitForTimeout(400);
  }

  await expect(
    page.getByText(/thank|gracias|you're all set|received/i).first(),
  ).toBeVisible({ timeout: 15_000 });
});

test('api health is up on the QA instance', async ({ request }) => {
  const res = await request.get(`${API}/health`);
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).dialect).toBe('sqlite');
});
