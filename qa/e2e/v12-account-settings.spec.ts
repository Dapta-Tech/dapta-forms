import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * V12 — Settings moved behind the profile button.
 *
 * The rail used to carry "Brand kit" and "Settings" as nav links. Both are gone:
 * the bottom-left profile button (avatar + name) opens a two-item menu,
 * "Account settings" and "Log out", the way Dapta's admin panel does it, and
 * Account settings is its own area at /admin/account with a left sub-nav —
 * Workspaces · Brand kit · Notifications · Public page. Workspaces is new: one
 * card per workspace you belong to, Open (enter it) or Manage (its members and
 * invitations, WITHOUT switching into it). The old URLs redirect so bookmarks
 * and the rest of this harness keep working.
 *
 * Under test: apps/web/components/{admin-shell,profile-menu}.tsx,
 * apps/web/app/admin/account/** (layout, account-nav, workspaces list + detail,
 * brand-kit, notifications, public-page), and the two redirect stubs left at
 * apps/web/app/admin/{settings,branding}/page.tsx.
 *
 * Auth is the `local` dev stub (no credentials); the principal is the seeded
 * owner, resolved from GET /v1/me rather than hardcoded. Copy is the EN catalog
 * (`admin.chrome.profileMenu`, `admin.account.*`, `admin.notifications`,
 * `admin.brandKit`, `admin.settings.publicPage*`).
 */

const API = 'http://localhost:4400';
const NAV_COLLAPSED_COOKIE = 'forms.nav.collapsed';

/** The account sub-nav, in order, with the href each entry must carry. */
const ACCOUNT_NAV = [
  { testId: 'account-nav-workspaces', href: '/admin/account/workspaces', label: 'Workspaces' },
  { testId: 'account-nav-brand-kit', href: '/admin/account/brand-kit', label: 'Brand kit' },
  {
    testId: 'account-nav-notifications',
    href: '/admin/account/notifications',
    label: 'Notifications',
  },
  { testId: 'account-nav-public-page', href: '/admin/account/public-page', label: 'Public page' },
] as const;

interface Me {
  accountId: string;
  accountCode: string;
  accountName: string;
  memberId: string;
  email: string | null;
  displayName: string | null;
  role: string;
}

/** Literal text into a RegExp source. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The local-stub principal — the seeded owner — never hardcoded. */
async function whoAmI(request: APIRequestContext): Promise<Me> {
  const res = await request.get(`${API}/v1/me`);
  expect(res.ok(), `GET /v1/me ${res.status()}`).toBeTruthy();
  const me = (await res.json()) as Me;
  expect(me.accountId, '/v1/me carries the home workspace id').toBeTruthy();
  expect(me.memberId, '/v1/me carries the member id').toBeTruthy();
  return me;
}

/**
 * The rail is mounted twice — desktop rail and mobile drawer — and the
 * breakpoint display:none-s whichever is not in play, so anything that lives in
 * it has to be resolved to the visible copy first.
 */
function visibleTestId(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true }).first();
}

/** The account sub-nav, on whichever account page is open. */
async function expectAccountNav(page: Page) {
  const nav = visibleTestId(page, 'account-nav');
  await expect(nav, 'the account sub-nav renders').toBeVisible({ timeout: 20_000 });
  for (const item of ACCOUNT_NAV) {
    const link = nav.getByTestId(item.testId);
    await expect(link, `${item.testId} is in the sub-nav`).toBeVisible();
    await expect(link, `${item.testId} points at ${item.href}`).toHaveAttribute('href', item.href);
    await expect(link, `${item.testId} is labelled`).toContainText(item.label);
  }
  return nav;
}

test.describe('V12: account settings behind the profile menu', () => {
  // A cold `next dev` compiles each account route on first hit; four routes in
  // one test can outrun the default 30s.
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page, context }) => {
    // Desktop, expanded rail: where the removed links used to be the most
    // visible, and where the profile button shows name + email, not just the
    // avatar.
    await context.addCookies([
      { name: NAV_COLLAPSED_COOKIE, value: '0', url: 'http://localhost:3400' },
    ]);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('the rail has no Settings or Brand kit links; the profile menu opens Account settings', async ({
    page,
  }) => {
    await page.goto('/admin/forms');

    // The nav rendered — so the absence below is a real absence, not a blank rail.
    const railNav = page.locator('aside nav').first();
    await expect(
      railNav.locator('a[href="/admin/integrations"]'),
      'the rail nav is up',
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.locator('aside a[href="/admin/settings"], aside a[href="/admin/branding"]'),
      'no rail link points at the old Settings or Branding routes',
    ).toHaveCount(0);
    await expect(
      page.locator('aside nav').getByRole('link', { name: /^(settings|brand kit|branding)$/i }),
      'no rail nav entry is called Settings or Brand kit',
    ).toHaveCount(0);

    // The profile button sits in the rail's footer and opens the menu: an
    // "Account settings" eyebrow, the four account entries, then Log out.
    const trigger = visibleTestId(page, 'profile-menu-trigger');
    await expect(trigger, 'the profile button renders in the rail').toBeVisible();
    await trigger.click();
    const menu = page.getByTestId('profile-menu');
    await expect(menu, 'the profile menu opens').toBeVisible();
    await expect(menu).toContainText('Account settings');

    const accountSettings = menu.getByTestId('profile-account-settings');
    const signOut = menu.getByTestId('profile-sign-out');
    await expect(accountSettings).toBeVisible();
    await expect(accountSettings).toContainText('Workspaces');
    for (const [id, label] of [
      ['profile-nav-brand-kit', 'Brand kit'],
      ['profile-nav-notifications', 'Notifications'],
      ['profile-nav-public-page', 'Public page'],
    ] as const) {
      await expect(menu.getByTestId(id), `${label} is one tap away`).toContainText(label);
    }
    await expect(signOut).toBeVisible();
    await expect(signOut).toContainText('Log out');

    // Workspaces is the landing entry of Account settings.
    await accountSettings.click();
    await expect(page).toHaveURL(/\/admin\/account\/workspaces\/?$/, { timeout: 20_000 });
    await expect(menu, 'choosing an item closes the menu').toBeHidden();
    await expectAccountNav(page);
  });

  test('the old Settings and Branding URLs redirect into the account area', async ({ page }) => {
    await page.goto('/admin/settings');
    await expect(page).toHaveURL(/\/admin\/account\/workspaces\/?$/, { timeout: 20_000 });
    expect(new URL(page.url()).pathname).toBe('/admin/account/workspaces');
    await expectAccountNav(page);

    await page.goto('/admin/branding');
    await expect(page).toHaveURL(/\/admin\/account\/brand-kit\/?$/, { timeout: 20_000 });
    expect(new URL(page.url()).pathname).toBe('/admin/account/brand-kit');
    await expect(page.getByRole('heading', { name: 'Brand kit', exact: true }).first()).toBeVisible(
      {
        timeout: 20_000,
      },
    );

    // The bare area root has no page of its own either.
    await page.goto('/admin/account');
    await expect(page).toHaveURL(/\/admin\/account\/workspaces\/?$/, { timeout: 20_000 });
  });

  test('Workspaces: the current one is marked and not re-openable; Manage lands on its members', async ({
    page,
    request,
  }) => {
    const me = await whoAmI(request);

    await page.goto('/admin/account/workspaces');
    await expectAccountNav(page);
    await expect(
      page.getByTestId('workspace-new'),
      'the New workspace button is in the header',
    ).toBeVisible();
    await expect(page.getByTestId('workspace-search'), 'the search box renders').toBeVisible();

    const cards = page.getByTestId('workspace-cards');
    await expect(cards, 'the cards container renders').toBeVisible({ timeout: 20_000 });
    const anyCard = page.getByTestId('workspace-card');
    await expect(anyCard.first(), 'at least one workspace card renders').toBeVisible();

    // The workspace the session is in: badge on, Open off (there is nothing to
    // switch to), Manage still live.
    const current = page.locator(
      `[data-testid="workspace-card"][data-account-id="${me.accountId}"]`,
    );
    await expect(current, 'the current workspace has a card').toHaveCount(1);
    await expect(
      current.getByText('Current', { exact: true }),
      'the current badge is on it',
    ).toBeVisible();
    await expect(
      current.getByTestId('workspace-open'),
      'Open is disabled for the current workspace',
    ).toBeDisabled();
    await expect(current.getByTestId('workspace-manage'), 'Manage is available').toBeVisible();

    // The search filters client-side by name; a nonsense needle empties the list
    // and clearing it brings the cards back.
    const search = page.getByTestId('workspace-search');
    await search.fill('zz-no-such-workspace-zz');
    await expect(
      page.getByTestId('workspace-card'),
      'no card matches the nonsense needle',
    ).toHaveCount(0);
    await search.fill('');
    await expect(current, 'clearing the search restores the cards').toBeVisible();

    // Manage: the per-workspace page, members first.
    await current.getByTestId('workspace-manage').click();
    await page.waitForURL((url) => url.pathname === `/admin/account/workspaces/${me.accountId}`, {
      timeout: 20_000,
    });
    await expect(page.getByTestId('workspace-tab-members'), 'the Members tab renders').toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByTestId('workspace-tab-invitations'),
      'the Invitations tab renders',
    ).toBeVisible();

    const membersTable = page.getByTestId('members-table');
    await expect(membersTable, 'the members table is the default tab').toBeVisible();
    const myRow = membersTable.locator(
      `[data-testid="member-row"][data-member-id="${me.memberId}"]`,
    );
    await expect(myRow, 'the seeded owner has a row').toBeVisible();
    // The row names the person — by display name or by email, whichever the
    // seed gave them.
    const identity = [me.displayName, me.email].filter((v): v is string => !!v).map(escapeRegExp);
    if (identity.length) {
      await expect(myRow, 'the row identifies the owner').toContainText(
        new RegExp(identity.join('|')),
      );
    }

    // Invitations: either the table (identity service present) or the empty
    // state — the QA database has neither an identity service nor pending
    // invitations, so the empty state is what it usually shows.
    await page.getByTestId('workspace-tab-invitations').click();
    await expect(
      page
        .getByTestId('invitations-table')
        .or(page.getByText('No pending invitations.', { exact: true }))
        .first(),
      'the Invitations tab shows its table or its empty state',
    ).toBeVisible();

    // And back.
    await page.getByTestId('workspace-tab-members').click();
    await expect(membersTable, 'the members table returns').toBeVisible();
    await expect(myRow).toBeVisible();
  });

  test('Workspaces: the whole card is a way into Manage, the action row is not', async ({
    page,
    request,
  }) => {
    const me = await whoAmI(request);
    await page.goto('/admin/account/workspaces');
    const current = page.locator(
      `[data-testid="workspace-card"][data-account-id="${me.accountId}"]`,
    );
    await expect(current, 'the current workspace has a card').toBeVisible({ timeout: 20_000 });
    await expect(current, 'the card shows the hand, not the arrow').toHaveCSS('cursor', 'pointer');
    // Pointer only: the list keeps its semantics and the Manage link stays the
    // keyboard way in, so the card itself is neither a link nor a tab stop.
    await expect(current).not.toHaveAttribute('role', /.+/);
    await expect(current).not.toHaveAttribute('tabindex', /.+/);

    // The action row swallows its clicks: the gap to the right of Manage is
    // still the row, so a click there must not fall through to the card.
    const row = current.locator('div.mt-auto');
    const rowBox = (await row.boundingBox())!;
    await row.click({ position: { x: rowBox.width - 6, y: rowBox.height / 2 } });
    await page.waitForTimeout(500);
    expect(new URL(page.url()).pathname, 'the action row is not a card click').toBe(
      '/admin/account/workspaces',
    );

    // The body of the card (the role line) is.
    await current.getByText('Your role', { exact: false }).click();
    await page.waitForURL((url) => url.pathname === `/admin/account/workspaces/${me.accountId}`, {
      timeout: 20_000,
    });
    await expect(page.getByTestId('workspace-tab-members'), 'Manage opened').toBeVisible({
      timeout: 20_000,
    });
  });

  test('Home links to the public page only while it is published', async ({ page, request }) => {
    const me = await whoAmI(request);
    const before = await request.get(`${API}/v1/me/profile`);
    expect(before.ok(), `GET /v1/me/profile ${before.status()}`).toBeTruthy();
    const original = (await before.json()) as { handle: string | null; profile: unknown };
    test.skip(!original.handle, 'the seeded owner has no handle, so there is no public page');

    const setEnabled = async (enabled: boolean) => {
      const res = await request.put(`${API}/v1/me/profile`, {
        data: { profile: { version: 1, enabled } },
      });
      expect(res.ok(), `PUT /v1/me/profile ${res.status()}`).toBeTruthy();
    };

    try {
      await setEnabled(true);
      await page.goto('/admin');
      const box = page.getByTestId('home-public-page');
      await expect(box, 'published: Home shows the public page box').toBeVisible({
        timeout: 20_000,
      });
      // The link is the PAGE (/{code}/{handle}), not one of the forms.
      await expect(box).toContainText(`/${me.accountCode}/${original.handle}`);
      await expect(box, 'the box copies the page, not a form').not.toContainText(
        new RegExp(`/${escapeRegExp(me.accountCode)}/${escapeRegExp(original.handle!)}/.+`),
      );
      await expect(box.getByRole('link', { name: /Open/ })).toHaveAttribute(
        'href',
        `/${me.accountCode}/${original.handle}`,
      );

      await setEnabled(false);
      await page.goto('/admin');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
      await expect(
        page.getByTestId('home-public-page'),
        'unpublished: the box is gone rather than pointing at a 404',
      ).toHaveCount(0);
    } finally {
      const res = await request.put(`${API}/v1/me/profile`, {
        data: { profile: original.profile ?? null },
      });
      expect(res.ok(), 'the original profile is restored').toBeTruthy();
    }
  });

  test('Notifications, Public page and Brand kit render inside the account frame', async ({
    page,
  }) => {
    // Notifications: the two editable email cards, unchanged from Settings.
    await page.goto('/admin/account/notifications');
    await expectAccountNav(page);
    await expect(
      page.getByRole('heading', { name: 'Notifications', level: 2 }).first(),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId('notifications-form-override-note')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: 'New submission notice', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: 'Respondent confirmation', exact: true }),
    ).toBeVisible();

    // Public page: the switch + headline + bio section.
    await page.goto('/admin/account/public-page');
    await expectAccountNav(page);
    const publicPage = page.getByTestId('public-page-settings');
    await expect(publicPage, 'the public page section renders').toBeVisible({ timeout: 20_000 });
    await expect(
      publicPage.getByRole('heading', { name: 'Your public page', exact: true }),
    ).toBeVisible();

    // Brand kit: title + the panel (the logo field renders for every role).
    await page.goto('/admin/account/brand-kit');
    await expectAccountNav(page);
    await expect(page.getByRole('heading', { name: 'Brand kit', exact: true }).first()).toBeVisible(
      {
        timeout: 20_000,
      },
    );
    await expect(page.getByTestId('brand-logo-url'), 'the brand kit panel renders').toBeVisible();
  });
});
