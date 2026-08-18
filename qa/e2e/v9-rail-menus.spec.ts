import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * The sidebar rail's popup menus must open ON TOP of the page, everywhere.
 *
 * The rail is a scroll container AND its own stacking context (`md:sticky` on
 * desktop, `fixed … z-50 … -translate-x-full` for the mobile drawer). Both of
 * those trap a child menu: overflow clips it at the rail's edge, and the
 * stacking context caps its z-index against the page, so any positioned element
 * inside <main> — a `relative` question card in the builder is enough — paints
 * over it. An earlier fix moved the app switcher to `position: fixed`, which
 * beat the clip but not the stacking context, and never touched the workspace
 * switcher at all. Both now render through AnchoredMenu, a portal to
 * document.body — and so does the bottom-left profile menu (Account settings /
 * Log out) that replaced the Settings and Brand kit rail links.
 *
 * Under test: apps/web/components/ui/anchored-menu.tsx, app-switcher.tsx,
 * workspace-switcher.tsx, profile-menu.tsx, admin-shell.tsx.
 *
 * The assertion is a hit test, not a screenshot: at five points across the open
 * panel, document.elementFromPoint must return the panel or one of its
 * descendants. A menu that is clipped, off-viewport, or painted under the
 * canvas fails it — which is exactly what the pre-fix build does on the builder
 * route.
 *
 * Coverage: every admin route in the nav, the account-settings area behind the
 * profile menu, and the builder, in the expanded rail, the collapsed rail, and
 * the <768px drawer. Requires two workspaces for the workspace switcher to
 * render at all; the suite seeds them if the QA database only has the single
 * seeded account.
 */

const API = 'http://localhost:4400';
const NAV_COLLAPSED_COOKIE = 'forms.nav.collapsed';
/**
 * The mobile top bar's hamburger (`admin.chrome.openNav`, EN + ES). Named
 * precisely: the rail's profile button is labelled "Account menu", so a loose
 * /menu/ pattern would have two candidates once the drawer is in the tree.
 */
const OPEN_NAV = /open navigation|abrir navegaci/i;

/**
 * Every admin surface reachable from the rail, plus the account-settings area
 * behind the profile menu — still inside the shell, still with the rail.
 */
const ROUTES = [
  '/admin',
  '/admin/forms',
  '/admin/submissions',
  '/admin/analytics',
  '/admin/integrations',
  '/admin/account/workspaces',
  '/admin/account/brand-kit',
];

type Switcher = 'app-switcher' | 'workspace-switcher' | 'profile-menu';

/**
 * The trigger and the (portalled) panel for each menu. The two switchers follow
 * the `<name>-trigger` / `<name>-menu` convention; the profile menu's panel is
 * plain `profile-menu`, which is why this is a table and not a template.
 */
const TEST_IDS: Record<Switcher, { trigger: string; menu: string }> = {
  'app-switcher': { trigger: 'app-switcher-trigger', menu: 'app-switcher-menu' },
  'workspace-switcher': { trigger: 'workspace-switcher-trigger', menu: 'workspace-switcher-menu' },
  'profile-menu': { trigger: 'profile-menu-trigger', menu: 'profile-menu' },
};

interface HitTest {
  ok: boolean;
  reason: string;
}

/**
 * The panel is open, fully inside the viewport, and nothing paints over it.
 *
 * elementFromPoint answers the only question that matters here — "if the user
 * clicked this pixel, would they hit the menu?" — and it is blind to WHY the
 * answer is no, so it catches the clip and the stacking-context bug alike.
 */
async function expectMenuOnTop(page: Page, which: Switcher, where: string) {
  const result = await page.evaluate<HitTest, string>((testId) => {
    const menu = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    if (!menu) return { ok: false, reason: 'the panel is not in the DOM' };

    const rect = menu.getBoundingClientRect();
    // Not merely present — usable. The pre-fix workspace switcher stretched to
    // its trigger (`left-0 right-0`), which in the 64px rail meant a 47px panel
    // of truncated account names. Nothing painted over it; it was still broken.
    if (rect.width < 180 || rect.height < 24) {
      return { ok: false, reason: `the panel is only ${Math.round(rect.width)}x${Math.round(rect.height)}` };
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.left < 0 || rect.top < 0 || rect.right > vw || rect.bottom > vh) {
      return {
        ok: false,
        reason:
          `the panel spills out of the ${vw}x${vh} viewport ` +
          `(l=${Math.round(rect.left)} t=${Math.round(rect.top)} ` +
          `r=${Math.round(rect.right)} b=${Math.round(rect.bottom)})`,
      };
    }

    // Four corners plus the middle: a partially covered panel fails too.
    const points: Array<[number, number]> = [
      [rect.left + 4, rect.top + 4],
      [rect.right - 4, rect.top + 4],
      [rect.left + 4, rect.bottom - 4],
      [rect.right - 4, rect.bottom - 4],
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
    ];
    for (const [x, y] of points) {
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === menu || menu.contains(hit))) {
        const tag = hit ? hit.tagName.toLowerCase() : 'nothing';
        const cls = hit?.getAttribute('class')?.slice(0, 90) ?? '';
        return {
          ok: false,
          reason: `at ${Math.round(x)},${Math.round(y)} the top element is <${tag} class="${cls}"> — not the panel`,
        };
      }
    }
    return { ok: true, reason: 'on top' };
  }, TEST_IDS[which].menu);

  expect(result.ok, `${which} on ${where}: ${result.reason}`).toBe(true);
}

/**
 * Each menu is mounted twice — once in the desktop rail, once in the mobile
 * drawer — and the breakpoint display:none-s whichever is not in play. Only the
 * visible one is the one under test.
 */
function triggerFor(page: Page, which: Switcher) {
  return page.getByTestId(TEST_IDS[which].trigger).filter({ visible: true }).first();
}

/** Open one menu and hit-test it, then close it again. */
async function openAndCheck(page: Page, which: Switcher, where: string) {
  const trigger = triggerFor(page, which);
  await expect(trigger, `${which} trigger renders on ${where}`).toBeVisible({ timeout: 20_000 });
  await trigger.click();
  const menu = page.getByTestId(TEST_IDS[which].menu);
  await expect(menu, `${which} opens on ${where}`).toBeVisible();
  await expectMenuOnTop(page, which, where);
  await page.keyboard.press('Escape');
  await expect(menu, `${which} closes on Escape on ${where}`).toBeHidden();
}

/** The workspace switcher only renders for someone with two or more accounts. */
async function seedSecondWorkspace(request: APIRequestContext) {
  const res = await request.get(`${API}/v1/workspaces`);
  expect(res.ok(), 'GET /v1/workspaces should answer').toBeTruthy();
  const rows = (await res.json()) as unknown[];
  return Array.isArray(rows) && rows.length >= 2;
}

async function firstFormId(request: APIRequestContext) {
  const list = await request.get(`${API}/v1/forms`);
  expect(list.ok(), 'GET /v1/forms should answer').toBeTruthy();
  const body = (await list.json()) as Array<{ id: string }> | { items: Array<{ id: string }> };
  const items = Array.isArray(body) ? body : body.items;
  if (items?.length) return items[0].id;

  const created = await request.post(`${API}/v1/forms`, {
    data: {
      name: 'v9-rail-menus',
      config: {
        version: 1,
        cover: { enabled: false },
        steps: [
          { key: 'q1', type: 'text', question: 'Your name?' },
          { key: 'q2', type: 'email', question: 'Work email?' },
        ],
      },
    },
  });
  expect(created.status(), 'POST /v1/forms should create the fixture form').toBe(201);
  return ((await created.json()) as { id: string }).id;
}

test.describe('V9 — rail menus open above the page on every admin surface', () => {
  test.describe.configure({ timeout: 180_000 });

  let hasWorkspaces = false;
  let formId = '';

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    hasWorkspaces = await seedSecondWorkspace(request);
    formId = await firstFormId(request);
    await request.dispose();
  });

  /**
   * Every rail menu, on one route, at whatever rail state the caller set up:
   * the two switchers at the top and the profile menu at the bottom, which
   * opens UPWARD from the rail's footer and so exercises the flip branch.
   */
  async function checkRoute(page: Page, path: string, state: string) {
    await page.goto(path);
    const where = `${path} (${state})`;
    await openAndCheck(page, 'app-switcher', where);
    if (hasWorkspaces) await openAndCheck(page, 'workspace-switcher', where);
    await openAndCheck(page, 'profile-menu', where);
  }

  test('expanded desktop rail — every nav route', async ({ page, context }) => {
    await context.addCookies([
      { name: NAV_COLLAPSED_COOKIE, value: '0', url: 'http://localhost:3400' },
    ]);
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const path of ROUTES) await checkRoute(page, path, 'expanded rail');
  });

  test('collapsed 64px rail — every nav route', async ({ page, context }) => {
    // Server-rendered from the cookie, so the rail is already collapsed on the
    // first paint — the state the original bug report was filed against.
    await context.addCookies([
      { name: NAV_COLLAPSED_COOKIE, value: '1', url: 'http://localhost:3400' },
    ]);
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const path of ROUTES) await checkRoute(page, path, 'collapsed rail');
  });

  test('the builder — the canvas must not paint over the menus', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // The editor force-collapses the rail and fills <main> with positioned
    // question cards. This is the screenshot in the bug report.
    await page.goto(`/admin/forms/${formId}/edit`);
    await expect(triggerFor(page, 'app-switcher')).toBeVisible({ timeout: 25_000 });
    await checkRoute(page, `/admin/forms/${formId}/edit`, 'builder');
  });

  test('per-form tabs — submissions, analytics and integrations', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const tab of ['submissions', 'analytics', 'integrations']) {
      await checkRoute(page, `/admin/forms/${formId}/${tab}`, 'form tab');
    }
  });

  test('the 375px drawer — menus clear the off-canvas nav', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/admin/forms');
    const where = '/admin/forms (mobile drawer)';

    // Escape is wired to the drawer as well as to the menu, so dismissing a
    // menu takes the drawer with it — re-open before each menu rather than
    // chaining them.
    const openDrawer = async () => {
      await page.getByRole('button', { name: OPEN_NAV }).first().click();
      // Slid fully in, not mid-transition: the trigger has to be clickable.
      await expect(triggerFor(page, 'app-switcher')).toBeInViewport();
    };

    await openDrawer();
    await openAndCheck(page, 'app-switcher', where);
    if (hasWorkspaces) {
      await openDrawer();
      await openAndCheck(page, 'workspace-switcher', where);
    }
    // The profile menu sits in the drawer's footer, at the very bottom of the
    // 812px viewport, so its panel has to flip up AND clear the off-canvas nav.
    await openDrawer();
    await openAndCheck(page, 'profile-menu', where);
  });

  test('the open drawer contains assistive tech with inert, not aria-modal', async ({ page }) => {
    // The menus portal to <body>, outside the drawer. aria-modal would hide
    // them from screen readers on mobile and nowhere else, so the drawer leans
    // on inert siblings instead — which leaves the portal reachable. Portalling
    // into the drawer to keep aria-modal is not an option: its overflow clips
    // the panel, which the hit test above catches.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/admin/forms');
    await page.getByRole('button', { name: OPEN_NAV }).first().click();
    await expect(triggerFor(page, 'app-switcher')).toBeInViewport();

    const state = await page.evaluate(() => {
      const drawer = document.querySelector('aside[role="dialog"]');
      const rail = document.querySelector('aside:not([role="dialog"])');
      return {
        ariaModal: drawer?.getAttribute('aria-modal') ?? null,
        drawerInert: drawer?.hasAttribute('inert') ?? null,
        headerInert: document.querySelector('header')?.hasAttribute('inert') ?? null,
        mainInert: document.querySelector('main')?.hasAttribute('inert') ?? null,
        railDisplay: rail ? getComputedStyle(rail).display : null,
      };
    });

    expect(state.ariaModal, 'the drawer does not hide the portalled menus').toBeNull();
    expect(state.drawerInert, 'the open drawer itself is reachable').toBe(false);
    expect(state.headerInert, 'the top bar is inert behind it').toBe(true);
    expect(state.mainInert, 'and so is the page').toBe(true);
    expect(state.railDisplay, 'the desktop rail is out of the tree at this width').toBe('none');
  });

  test('the menu follows its trigger while the page scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 700 });
    // The brand kit is the longest admin page: logo, client logos, colors,
    // typography, controls, the apply list and the preview all stack, so a
    // 700px viewport always has somewhere to scroll to.
    await page.goto('/admin/account/brand-kit');
    await triggerFor(page, 'app-switcher').click();
    const menu = page.getByTestId('app-switcher-menu');
    await expect(menu).toBeVisible();
    const before = await menu.boundingBox();

    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(150);
    // The rail is sticky, so the trigger has not moved — and neither should the
    // panel. The predecessor closed on any scroll event, which made a trackpad
    // nudge feel like the menu had crashed.
    await expect(menu, 'the panel survives a scroll').toBeVisible();
    const after = await menu.boundingBox();
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0)), 'the panel stays glued to its trigger').toBeLessThan(4);
    await expectMenuOnTop(page, 'app-switcher', '/admin/account/brand-kit after scrolling');
  });

  test('a panel taller than the space available clamps and scrolls in place', async ({ page }) => {
    // The panel is position:fixed, so nothing the user scrolls can bring an
    // overflowing one back — it has to scroll inside itself. Squeezing the
    // viewport is the deterministic way to reach that branch; the QA database
    // only ever seeds a handful of workspaces, so the panel always fit before.
    await page.setViewportSize({ width: 1440, height: 160 });
    await page.goto('/admin/forms');
    await triggerFor(page, 'app-switcher').click();
    const menu = page.getByTestId('app-switcher-menu');
    await expect(menu).toBeVisible();

    const geometry = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-testid="app-switcher-menu"]')!;
      const rect = el.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        viewport: window.innerHeight,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        overflowY: getComputedStyle(el).overflowY,
      };
    });

    expect(geometry.top, 'the panel starts inside the viewport').toBeGreaterThanOrEqual(0);
    expect(geometry.bottom, 'and it ends inside it too').toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.overflowY, 'the overflow scrolls rather than spilling').toBe('auto');
    expect(
      geometry.scrollHeight,
      'this viewport really is too short for the panel — otherwise the test proves nothing',
    ).toBeGreaterThan(geometry.clientHeight);

    // The content below the fold is reachable by scrolling the panel itself.
    const last = menu.locator('[role="menuitem"]').last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
  });

  test('dismissing hands focus back to the trigger', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/admin/forms');
    const trigger = triggerFor(page, 'app-switcher');
    await trigger.click();
    const menu = page.getByTestId('app-switcher-menu');
    await expect(menu).toBeVisible();

    // autoFocus only works once the panel is placed — before the fix it ran a
    // frame early, against a visibility:hidden panel, and silently did nothing.
    await expect(
      menu.locator('[role="menuitem"]').first(),
      'focus lands on the first item once the panel is placed',
    ).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    // The panel is a portal at the end of its container, so without an explicit
    // hand-back the caret is left on the document, nowhere near the rail.
    await expect(trigger, 'Escape returns focus to the trigger').toBeFocused();
  });

  test('clicking the page dismisses the menu', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/admin/forms');
    const trigger = triggerFor(page, 'app-switcher');
    await trigger.click();
    const menu = page.getByTestId('app-switcher-menu');
    await expect(menu).toBeVisible();
    // The panel is a portal now, so outside-click detection has to test the
    // trigger and the panel separately — a naive wrapper check would close it
    // when an item inside was clicked.
    await page.mouse.click(900, 500);
    await expect(menu, 'an outside click closes it').toBeHidden();

    await trigger.click();
    await expect(menu, 'and it reopens').toBeVisible();
    await trigger.click();
    await expect(menu, 'the trigger toggles it shut').toBeHidden();
  });
});
