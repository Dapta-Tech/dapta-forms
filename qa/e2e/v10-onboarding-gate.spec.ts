import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * The first-run gate, from the outside.
 *
 * Four things this suite could not see before, each of which the unit tests
 * cannot reach because they are about what the BROWSER ends up looking at:
 *
 *  1. The seeded demo account lands on the DASHBOARD. `db:setup` runs migrate
 *     before seed, so migration 0011's backfill sweeps the table before the demo
 *     row exists and never stamps it — leaving the one account in a fresh
 *     database still owed a wizard. With the flag on by default that redirected
 *     `pnpm dev` into `/onboarding` and took most of this suite with it, since
 *     every spec that opens `/admin/...` would have followed the same redirect.
 *
 *  2. A plain MEMBER of an un-onboarded workspace reaches a real page. The gate
 *     was account-scoped and the wizard's endpoints are admin-scoped, so a
 *     colleague of an owner who abandoned the wizard was sent to `/onboarding`,
 *     403'd on every write, 403'd on the completion, and bounced back by the
 *     same gate. The wizard renders no sidebar and no sign-out: that loop had no
 *     exit.
 *
 *  3. The "Creating your form" interstitial actually PAINTS while the request is
 *     in flight, and the CTA stops being clickable. `startSubmit(() => void
 *     action())` returns undefined rather than a thenable, so React ended the
 *     transition in the same tick and the last screen before the builder read as
 *     a frozen page with a live button.
 *
 *  4. Scrolling the builder during the coach-mark tour does not steal the caret.
 *     `place()` returns a fresh object every call and the focus effect depended
 *     on it, so every scroll event — captured from every nested scroller in the
 *     builder — re-focused the tour card out of whatever was being typed in.
 *
 * Under test: apps/api/src/admin.service.ts (`me`), apps/web/app/admin/layout.tsx,
 * apps/web/app/onboarding/{wizard,actions}.tsx, packages/db/src/seed.ts,
 * apps/web/app/admin/forms/[id]/edit/_components/builder-tour.tsx.
 */

const API = 'http://localhost:4400';

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

/**
 * Answer whichever of the three questions is on screen and advance.
 *
 * Two shapes, because the wizard renders through the PUBLIC renderer's own
 * components rather than a bespoke set: role and use case are choice cards
 * (`multiple_choice`), industry is a searchable dropdown (`combobox`) whose
 * options only exist once it is open. Choosing IS continuing on both — there is
 * no Next button to click.
 */
async function answerCurrentQuestion(page: Page): Promise<void> {
  const combobox = page.locator('.pf__fields [role="combobox"]');
  if (await combobox.count()) {
    await combobox.click();
    const option = page.locator('.pf-dropdown__list button').first();
    await expect(option).toBeVisible();
    await option.click();
    return;
  }
  const choice = page.locator('.pf__fields button').first();
  await expect(choice).toBeVisible();
  await choice.click();
}

/** Walk the three questions and stop on the template picker. */
async function walkQuestions(page: Page): Promise<void> {
  for (const label of ['1 of 3', '2 of 3', '3 of 3']) {
    await expect(page.locator('.ob__eyebrow'), `never reached question ${label}`).toBeVisible();
    await answerCurrentQuestion(page);
  }
}

test.describe('the first-run gate', () => {
  test('the seeded demo account lands on the dashboard, not the wizard', async ({ page }) => {
    // No dev-login cookie at all: the local stub falls back to the FIRST seeded
    // account, which is the demo one. This is the exact path `pnpm dev` takes.
    await page.context().clearCookies();
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin$/);
    // The sidebar, which the wizard deliberately does not render — there is
    // nowhere to wander off to before a first form exists. Its presence is what
    // says this is the dashboard and not a wizard that happens to sit at /admin.
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Forms', exact: true })).toBeVisible();
  });

  test('a plain member of an un-onboarded workspace is NOT trapped in the wizard', async ({
    page,
    request,
  }) => {
    const ownerEmail = freshEmail('owner');
    const colleagueEmail = freshEmail('colleague');

    // The owner signs in and ABANDONS the wizard: a JIT account whose
    // `onboarding_completed_at` is still NULL.
    const me = await asUser(request, ownerEmail).get(`${API}/v1/me`);
    expect(me.ok()).toBeTruthy();
    expect((await me.json()).onboardingRequired).toBe(true);

    // A colleague joins that same workspace, as a plain member.
    const invited = await asUser(request, ownerEmail).post(`${API}/v1/members`, {
      data: { email: colleagueEmail, role: 'member' },
    });
    expect(invited.status()).toBe(201);

    // The colleague signs in. Before the fix this landed on /onboarding and
    // every route back out returned to it.
    await signIn(page, colleagueEmail);
    await page.goto('/admin');
    await expect(page).not.toHaveURL(/\/onboarding/);

    // And the owner of that same workspace still owes the wizard — the account
    // is genuinely un-onboarded, only the question of who is asked changed.
    const ownerMe = await asUser(request, ownerEmail).get(`${API}/v1/me`);
    expect((await ownerMe.json()).onboardingRequired).toBe(true);
  });
});

test.describe('the wizard, end to end', () => {
  test('answers three questions, shows the interstitial, and lands in the builder', async ({
    page,
  }) => {
    await signIn(page, freshEmail('wizard'));
    await expect(page).toHaveURL(/\/onboarding/);

    await walkQuestions(page);

    // The template screen arms its recommended card, so the CTA is live.
    const cta = page.locator('.ob__cta');
    await expect(cta).toBeEnabled();
    await cta.click();

    // The interstitial has to be on screen while the round trip runs. Without
    // the awaited transition the transition ended in the same tick, so this
    // never rendered at all and the CTA stayed live for the whole request.
    await expect(page.locator('.ob__creating-track')).toBeVisible();
    await expect(cta).toHaveCount(0);

    await page.waitForURL(/\/admin\/forms\/[^/]+\/edit/, { timeout: 20_000 });
    expect(page.url()).toContain('tour=1');
  });

  test('the coach marks do not steal the caret when the builder scrolls', async ({ page }) => {
    await signIn(page, freshEmail('tour'));
    await expect(page).toHaveURL(/\/onboarding/);
    await walkQuestions(page);
    await page.locator('.ob__cta').click();
    await page.waitForURL(/\/admin\/forms\/[^/]+\/edit/, { timeout: 20_000 });

    // The tour is up and the builder underneath is usable — that is the whole
    // reason the overlay is `pointer-events: none`.
    await expect(page.locator('.bt__card')).toBeVisible();

    const input = page.locator('main input[type="text"], main textarea').first();
    await expect(input).toBeVisible();
    await input.click();
    await expect(input).toBeFocused();

    // Scroll the way a person reading the tip would. Every one of these used to
    // re-place the card, hand the focus effect a new object identity, and pull
    // the caret out of this field.
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 120);
    await page.waitForTimeout(300);

    await expect(input).toBeFocused();
  });
});

/**
 * An API context that authenticates as one dev identity.
 *
 * The local auth stub reads `x-quill-email` and resolves — or JIT-creates — the
 * member behind it, which is the same path the web app takes for a local
 * session. Dev/test only; `loadServerEnv` refuses this provider in production.
 */
function asUser(request: APIRequestContext, email: string) {
  const headers = { 'x-quill-email': email, 'content-type': 'application/json' };
  return {
    get: (url: string) => request.get(url, { headers }),
    post: (url: string, opts: { data: unknown }) => request.post(url, { headers, ...opts }),
  };
}
