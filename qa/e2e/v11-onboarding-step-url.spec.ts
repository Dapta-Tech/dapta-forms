import { test, expect, type Page } from '@playwright/test';

/**
 * The wizard's URL mirror — `/onboarding?step=N` — from the outside.
 *
 * The unit tests pin the pure halves (`stepParam`, `stepIndexFromSearch`); what
 * only a browser can show is the wiring between three history writers that have
 * to agree:
 *
 *  1. The mount stamp is a REPLACE: question one and the bare `/onboarding` are
 *     one history entry, so browser-back from the first question exits the
 *     wizard instead of stepping to itself.
 *  2. Every move is a PUSH, and popstate moves the WIZARD, not just the URL —
 *     the half the Dapta adminpanel is missing, where back walks `?step=` while
 *     the screen stays put.
 *  3. A direct `?step=N` load is normalized by the server page: answers live
 *     only in client state, so the wizard restarts at question one and the URL
 *     must say so rather than lie to analytics.
 *
 * Local runs have no IAM_BASE_URL, so every fresh account resolves to the COLD
 * cohort: six questions starting with the phone screen, then the template
 * picker. Under test: apps/web/app/onboarding/{page,wizard}.tsx.
 */

/** A brand-new dev identity. The API's local stub JIT-creates its account. */
function freshEmail(tag: string): string {
  return `qa-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@onboarding.test`;
}

/** Sign the browser in as `email` through the real local-dev login screen. */
async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await Promise.all([page.waitForURL(/\/(admin|onboarding)/), page.click('button[type="submit"]')]);
}

/** The cold cohort's first question: type a usable phone, then Continue. */
async function answerPhone(page: Page): Promise<void> {
  const tel = page.locator('.pf__fields input[type="tel"]');
  await expect(tel).toBeVisible();
  await tel.fill('3001234567');
  await page.locator('.ob__cta').click();
}

test.describe('the step in the URL', () => {
  test('stamps, pushes, and follows the browser buttons', async ({ page }) => {
    await signIn(page, freshEmail('stepurl'));

    // Arrival: the mount effect re-writes the bare `/onboarding` entry.
    await page.waitForURL(/\/onboarding\?step=1$/);
    await expect(page.locator('.ob__eyebrow')).toContainText('1 of 6');

    // Answering pushes the next step.
    await answerPhone(page);
    await page.waitForURL(/\/onboarding\?step=2$/);
    await expect(page.locator('.ob__eyebrow')).toContainText('2 of 6');

    // The in-page back arrow mirrors too. `button.pf__back`, not `.pf__back`:
    // the topbar keeps a placeholder SPAN with the same class for centering.
    await page.locator('button.pf__back').click();
    await page.waitForURL(/\/onboarding\?step=1$/);
    await expect(page.locator('.ob__eyebrow')).toContainText('1 of 6');

    // Browser BACK returns to the pushed `?step=2` entry — and the wizard
    // follows the URL: question two is genuinely on screen, not just named in
    // the address bar. This is the popstate half.
    await page.goBack();
    await page.waitForURL(/\/onboarding\?step=2$/);
    await expect(page.locator('.ob__eyebrow')).toContainText('2 of 6');
  });

  test('normalizes a direct ?step=N load back to the first question', async ({ page }) => {
    await signIn(page, freshEmail('deeplink'));
    await page.waitForURL(/\/onboarding\?step=1$/);

    // A deep link cannot restore answers that never left the client, so the
    // server strips the stale step and the wizard re-stamps step one.
    await page.goto('/onboarding?step=5');
    await page.waitForURL(/\/onboarding\?step=1$/);
    await expect(page.locator('.ob__eyebrow')).toContainText('1 of 6');
  });
});
