import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * V13 — choosing the language the product speaks to you in.
 *
 * The app has shipped English and Spanish since the first-run wizard, but the
 * only thing that ever wrote the choice was the wizard itself: after that the
 * language was whatever it had been, with no control anywhere to change it.
 *
 * Under test: /admin/account/preferences (page + language-settings.tsx), the
 * server action behind it (apps/web/app/admin/locale-actions.ts) and the
 * endpoint it persists through (PUT /v1/me/locale). Three claims that only hold
 * once all of those are stacked:
 *
 *   1. the WHOLE admin re-renders in the new language, not only this page.
 *      Every page reads the cookie at render time, so the action revalidates the
 *      admin layout rather than its own route;
 *   2. the choice is stored on the MEMBER, not just in the browser. That is what
 *      makes it a user setting rather than a per-device one, and it is the value
 *      the account's notification emails are written from;
 *   3. `<html lang>` follows. It was hardcoded 'en' for the life of the app, so
 *      a Spanish dashboard told every screen reader and translator it was
 *      English.
 *
 * Auth is the `local` dev stub; the principal is the seeded owner. The QA
 * database OUTLIVES a run, and this is the rare spec that writes to the shared
 * principal's own row, so it restores the language it found before finishing.
 * Leaving Spanish behind would not break the specs that assert English copy
 * (those render from a cookie, and every test gets a fresh context) but it would
 * change the language of this account's submission emails for every later run.
 */

const API = 'http://localhost:4400';

type Locale = 'en' | 'es';

async function storedLocale(request: APIRequestContext): Promise<Locale | null> {
  const res = await request.get(`${API}/v1/me`);
  expect(res.ok(), `GET /v1/me ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { locale: Locale | null }).locale;
}

test.describe('V13: the language preference', () => {
  // A cold `next dev` compiles each admin route on first hit.
  test.describe.configure({ timeout: 120_000 });

  let found: Locale | null = null;

  test.beforeEach(async ({ request, page }) => {
    found = await storedLocale(request);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test.afterEach(async ({ request }) => {
    // Back to what it was. `null` cannot be restored through the endpoint (it
    // only accepts a real locale), so an account that had never chosen is left
    // on English, which is what every read of a null locale falls back to.
    await request.put(`${API}/v1/me/locale`, { data: { locale: found ?? 'en' } });
  });

  test('Preferences is reachable from the account sub-nav and carries the language control', async ({
    page,
  }) => {
    await page.goto('/admin/account/workspaces');

    const entry = page.getByTestId('account-nav-preferences').filter({ visible: true }).first();
    await expect(entry, 'Preferences is in the sub-nav').toBeVisible({ timeout: 20_000 });
    await entry.click();

    await expect(page).toHaveURL(/\/admin\/account\/preferences$/);
    await expect(page.getByTestId('preferences-language')).toBeVisible();
    // The options name themselves in their own language: the person most likely
    // to need this control is the one who cannot read the page it is on.
    await expect(page.locator('#language-select')).toContainText('English');
  });

  test('choosing Spanish re-renders the whole admin, survives a reload, and is stored on the member', async ({
    page,
    request,
  }) => {
    await page.goto('/admin/account/preferences');

    await page.locator('#language-select').click();
    await page.getByRole('option', { name: 'Español' }).click();

    // Not this page's heading: a sibling route's nav label. The action
    // revalidates the admin LAYOUT, so a change here has to reach every page.
    await expect(
      page.getByTestId('account-nav-brand-kit').filter({ visible: true }).first(),
      'the sub-nav is translated',
    ).toContainText('Kit de marca', { timeout: 20_000 });

    // The document now says what it is. Hardcoded 'en' before this.
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');

    // Stored, not merely painted: this is the half that makes it a USER setting
    // and the half the notification emails read.
    expect(await storedLocale(request)).toBe('es');

    // A different route, after a reload: the cookie is doing the work now, not
    // the in-flight transition.
    await page.goto('/admin/account/workspaces');
    await expect(
      page.getByTestId('account-nav-preferences').filter({ visible: true }).first(),
    ).toContainText('Preferencias');
  });

  test('and switching back to English puts it all the way back', async ({ page, request }) => {
    await page.goto('/admin/account/preferences');
    await page.locator('#language-select').click();
    await page.getByRole('option', { name: 'Español' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es', { timeout: 20_000 });

    // The control is the only way back, so it has to be findable and usable by
    // someone who cannot read the page around it. Its options never translate.
    await page.locator('#language-select').click();
    await page.getByRole('option', { name: 'English' }).click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en', { timeout: 20_000 });
    await expect(
      page.getByTestId('account-nav-brand-kit').filter({ visible: true }).first(),
    ).toContainText('Brand kit');
    expect(await storedLocale(request)).toBe('en');
  });

  test('a browser that has never chosen still gets English', async ({ page, request, context }) => {
    // The stored choice is deliberately NOT read per request - pages read the
    // cookie, and only the login callback reconciles the two. So a context with
    // no cookie renders the default even when the member row says Spanish, and
    // that is the behaviour every existing spec depends on.
    await request.put(`${API}/v1/me/locale`, { data: { locale: 'es' } });
    await context.clearCookies({ name: 'quill_locale' });

    await page.goto('/admin/account/workspaces');

    await expect(
      page.getByTestId('account-nav-brand-kit').filter({ visible: true }).first(),
    ).toContainText('Brand kit', { timeout: 20_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});
