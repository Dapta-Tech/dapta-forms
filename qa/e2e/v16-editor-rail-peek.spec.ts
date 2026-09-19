import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * The form editor's rail peeks open on hover.
 *
 * The editor rests on a 64px icon rail so the builder gets the canvas, but with
 * no labels there is no way to tell where any icon leads, so people click one
 * at random just to get out. The rail now widens to 240px while the pointer is
 * over it (or the keyboard focus is inside it), and it does so WITHOUT moving
 * the canvas: the aside leaves the flow, a 64px spacer keeps its column, and
 * the expanded panel is painted over <main>.
 *
 * Four properties this pins down, in rough order of how badly they would be
 * missed:
 *
 *   1. the canvas does not reflow. A `h-[100dvh] overflow-hidden` three-column
 *      builder that re-lays-out every time the pointer nears the left edge is
 *      unusable, and that is the whole reason for the overlay.
 *   2. the peek paints ABOVE the canvas. The rail is a stacking context at
 *      `z-auto` sitting before <main> in the DOM, so without an explicit
 *      z-index every `relative` question card paints over it. That is the same
 *      bug anchored-menu.tsx was written to work around.
 *   3. the peek never writes the saved preference. `forms.nav.collapsed` is the
 *      rail's state on every OTHER route; a hover must not overwrite it.
 *   4. reaching a menu the rail opened does not collapse the rail. Those panels
 *      portal to <body>, so the pointer travelling to one LEAVES the aside, and
 *      AnchoredMenu places its panel once and never re-places on its anchor
 *      moving. Collapsing there would strand the panel mid-air.
 *
 * Under test: apps/web/components/admin-shell.tsx (the `studio` branch) and the
 * `data-anchored-menu` marker in apps/web/components/ui/anchored-menu.tsx.
 * Companion suite: v9-rail-menus.spec.ts.
 */

const API = 'http://localhost:4400';
const NAV_COLLAPSED_COOKIE = 'forms.nav.collapsed';
const ORIGIN = 'http://localhost:3400';

/**
 * The SHELL's rail, and only it. `aside:not([role="dialog"])` is enough on the
 * list screens, but the editor renders two asides of its own (the question
 * spine and the settings panel), so on this route that selector matches three
 * elements and every locator built on it dies of strict mode. `bg-popover` is
 * the rail's own surface token; the mobile drawer shares it and is excluded by
 * its role.
 */
const RAIL = 'aside.bg-popover:not([role="dialog"])';
/** Likewise: the shell's <main>, not the editor's own scrolling column. */
const MAIN = 'main.flex-1';
const COLLAPSED_W = 64;
const EXPANDED_W = 240;

/** The rail's own width, polled: it animates, so one read is a coin toss. */
async function expectRailWidth(page: Page, width: number, why: string) {
  await expect
    .poll(async () => Math.round((await page.locator(RAIL).boundingBox())?.width ?? -1), {
      message: why,
      timeout: 5_000,
    })
    .toBe(width);
}

async function firstFormId(request: APIRequestContext) {
  const list = await request.get(`${API}/v1/forms`);
  expect(list.ok(), 'GET /v1/forms should answer').toBeTruthy();
  const body = (await list.json()) as Array<{ id: string }> | { items: Array<{ id: string }> };
  const items = Array.isArray(body) ? body : body.items;
  if (items?.length) return items[0].id;

  const created = await request.post(`${API}/v1/forms`, {
    data: {
      name: 'v16-editor-rail-peek',
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

test.describe('V16: the editor rail peeks open on hover', () => {
  test.describe.configure({ timeout: 120_000 });

  let formId = '';
  let editUrl = '';

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    formId = await firstFormId(request);
    editUrl = `/admin/forms/${formId}/edit`;
    await request.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('rests at 64px and peeks to 240px on hover', async ({ page }) => {
    await page.goto(editUrl);
    await expect(page.locator(RAIL)).toBeVisible({ timeout: 25_000 });
    await expectRailWidth(page, COLLAPSED_W, 'the editor rail rests collapsed');

    // The labels are the point of the peek, so assert on a label's box rather
    // than on its text: that keeps the test locale-agnostic. Collapsed, the
    // nav link is a 44px square tile; expanded it fills the 240px rail.
    const navLink = page.locator(`${RAIL} nav a[href="/admin/forms"]`);
    expect(Math.round((await navLink.boundingBox())!.width)).toBeLessThan(60);

    await page.locator(RAIL).hover();
    await expectRailWidth(page, EXPANDED_W, 'hovering the rail opens it');
    expect(
      Math.round((await navLink.boundingBox())!.width),
      'the nav links get their labels back',
    ).toBeGreaterThan(150);
  });

  test('the canvas does not move when the rail peeks', async ({ page }) => {
    await page.goto(editUrl);
    await expect(page.locator(RAIL)).toBeVisible({ timeout: 25_000 });
    await expectRailWidth(page, COLLAPSED_W, 'baseline');

    const before = (await page.locator(MAIN).boundingBox())!;
    await page.locator(RAIL).hover();
    await expectRailWidth(page, EXPANDED_W, 'peeked');
    const after = (await page.locator(MAIN).boundingBox())!;

    // Byte-identical, not merely close: the spacer holds the column, so there
    // is no reflow to be approximately right about.
    expect(after.x, '<main> must not be pushed right').toBe(before.x);
    expect(after.width, '<main> must not be narrowed').toBe(before.width);
  });

  test('the peeked rail paints above the canvas', async ({ page }) => {
    await page.goto(editUrl);
    await expect(page.locator(RAIL)).toBeVisible({ timeout: 25_000 });
    await page.locator(RAIL).hover();
    await expectRailWidth(page, EXPANDED_W, 'peeked');

    // 200px is inside the 240px rail and outside its 64px footprint, so this
    // point is over the canvas. The z-index regression guard.
    const onTop = await page.evaluate(() => {
      const rail = document.querySelector('aside.bg-popover:not([role="dialog"])');
      const hit = document.elementFromPoint(200, window.innerHeight / 2);
      if (!rail || !hit) return { ok: false, tag: 'nothing' };
      return {
        ok: hit === rail || rail.contains(hit),
        tag: `${hit.tagName.toLowerCase()} class="${hit.getAttribute('class')?.slice(0, 80) ?? ''}"`,
      };
    });
    expect(onTop.ok, `at 200,½vh the top element is <${onTop.tag}>, not the rail`).toBe(true);
  });

  test('it collapses again when the pointer leaves', async ({ page }) => {
    await page.goto(editUrl);
    await expect(page.locator(RAIL)).toBeVisible({ timeout: 25_000 });
    await page.locator(RAIL).hover();
    await expectRailWidth(page, EXPANDED_W, 'peeked');

    await page.mouse.move(900, 400);
    await expectRailWidth(page, COLLAPSED_W, 'leaving the rail closes the peek');
  });

  test('keyboard focus opens it and leaving the rail closes it', async ({ page }) => {
    // Hover is not reachable from a keyboard, and before this change the rail
    // toggle was not even in the DOM on this route, so there was no way in at
    // all. Focusing a specific control rather than counting Tab presses: the
    // behaviour under test is focus-within, not the tab order.
    await page.goto(editUrl);
    await expect(page.locator(RAIL)).toBeVisible({ timeout: 25_000 });
    await expectRailWidth(page, COLLAPSED_W, 'baseline');

    await page.locator(`${RAIL} nav a[href="/admin/forms"]`).focus();
    await expectRailWidth(page, EXPANDED_W, 'focus inside the rail opens it');

    await page.locator('[data-testid="canvas-title-input"]').first().focus();
    await expectRailWidth(page, COLLAPSED_W, 'focus leaving the rail closes it');
  });

  test('the peek never touches the saved preference', async ({ page, context }) => {
    // The rail's state on every other route. A hover in the editor must not be
    // able to overwrite it, in either direction.
    await context.addCookies([{ name: NAV_COLLAPSED_COOKIE, value: '0', url: ORIGIN }]);
    await page.goto(editUrl);
    await expect(page.locator(RAIL)).toBeVisible({ timeout: 25_000 });

    for (let i = 0; i < 3; i++) {
      await page.locator(RAIL).hover();
      await expectRailWidth(page, EXPANDED_W, `peek ${i + 1}`);
      await page.mouse.move(900, 400);
      await expectRailWidth(page, COLLAPSED_W, `leave ${i + 1}`);
    }

    const cookie = (await context.cookies(ORIGIN)).find((c) => c.name === NAV_COLLAPSED_COOKIE);
    expect(cookie?.value, 'the cookie is untouched').toBe('0');
    expect(
      await page.evaluate((k) => localStorage.getItem(k), NAV_COLLAPSED_COOKIE),
      'and so is localStorage: the editor never writes it',
    ).not.toBe('1');

    // The proof that matters to whoever set the preference: it still applies.
    await page.goto('/admin/forms');
    await expectRailWidth(page, EXPANDED_W, 'the saved expanded rail survived the editor');
  });

  test('hover does nothing outside the editor', async ({ page, context }) => {
    // The other side of the same rule: off the editor route the rail is the
    // saved preference and a pointer passing over it changes nothing.
    await context.addCookies([{ name: NAV_COLLAPSED_COOKIE, value: '1', url: ORIGIN }]);
    await page.goto('/admin/forms');
    await expect(page.locator(RAIL)).toBeVisible({ timeout: 25_000 });
    await expectRailWidth(page, COLLAPSED_W, 'collapsed by preference');

    await page.locator(RAIL).hover();
    // Give the peek's open delay time to fire, if it wrongly applied here.
    await page.waitForTimeout(500);
    await expectRailWidth(page, COLLAPSED_W, 'hover must not peek outside the editor');
  });

  test('the peek survives the pointer reaching a portalled menu', async ({ page }) => {
    // The trap this design exists around. The panel portals to <body>, so
    // moving onto it fires pointerleave on the aside. If that collapsed the
    // rail, the trigger would slide 176px left out from under a panel that
    // AnchoredMenu has already placed and will not re-place.
    await page.goto(editUrl);
    await expect(page.locator(RAIL)).toBeVisible({ timeout: 25_000 });
    await page.locator(RAIL).hover();
    await expectRailWidth(page, EXPANDED_W, 'peeked');

    await page.getByTestId('profile-menu-trigger').filter({ visible: true }).first().click();
    const panel = page.getByTestId('profile-menu');
    await expect(panel).toBeVisible();
    const placed = (await panel.boundingBox())!;

    await page.mouse.move(placed.x + placed.width / 2, placed.y + placed.height / 2);
    await page.waitForTimeout(600); // well past PEEK_CLOSE_MS
    await expectRailWidth(page, EXPANDED_W, 'the rail stays open under an open menu');
    const still = (await panel.boundingBox())!;
    expect(Math.round(still.x), 'and the panel has not drifted').toBe(Math.round(placed.x));
    expect(Math.round(still.y)).toBe(Math.round(placed.y));

    // The other half: once the menu is gone, nothing more will reach the rail,
    // so the deferred close has to re-check and fire on its own.
    //
    // Escape returns focus to the trigger, which is inside the rail, so the
    // guard still holds the peek open; the click is what finally moves focus
    // out. It lands at x=700, well clear of the 240px panel: clicking nearer
    // the left edge would hit the rail itself, which is the correct behaviour
    // and a useless assertion.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await page.mouse.move(900, 400);
    await page.mouse.click(700, 500);
    await expectRailWidth(page, COLLAPSED_W, 'and closes once the menu is dismissed');
  });

  test('the peek does not follow you back in from the forms list', async ({ page }) => {
    // Clicking a rail link navigates away with the pointer AND the focus still
    // inside the rail, so neither pointerleave nor blur fires and `peeking`
    // would stay true. Off the editor route nothing reads it, so the next
    // editor opened from the list would start 240px wide over its own canvas,
    // with the pointer nowhere near the rail to close it again.
    await page.goto(editUrl);
    await expect(page.locator(RAIL)).toBeVisible({ timeout: 25_000 });
    await page.locator(RAIL).hover();
    await expectRailWidth(page, EXPANDED_W, 'peeked');

    // Leave through the rail itself, which is the whole point of the peek.
    await page.locator(`${RAIL} nav a[href="/admin/forms"]`).click();
    await page.waitForURL('**/admin/forms');

    // Back into the editor, this time with the pointer over the canvas.
    await page.locator(`a[href="${editUrl}"]`).first().click();
    await page.waitForURL(`**${editUrl}`);
    await page.mouse.move(900, 500);
    await expectRailWidth(page, COLLAPSED_W, 'the editor opens collapsed, as it rests');
  });

  test('the rail toggle is a peek, not a preference', async ({ page, context }) => {
    // Hover is the primary affordance, but a touch device wide enough for the
    // desktop rail (an iPad, a touch laptop) has no hover at all. The toggle is
    // that fallback, and in the editor it must drive the peek only.
    await context.addCookies([{ name: NAV_COLLAPSED_COOKIE, value: '0', url: ORIGIN }]);
    await page.goto(editUrl);
    const toggle = page.getByTestId('rail-toggle');
    await expect(toggle, 'the toggle renders on the editor route again').toBeVisible({
      timeout: 25_000,
    });
    await expectRailWidth(page, COLLAPSED_W, 'baseline');

    await toggle.click();
    await expectRailWidth(page, EXPANDED_W, 'the toggle opens the peek');
    // The pointer is on the toggle, which is inside the rail, so the peek is
    // held open by hover too. Move out first, then toggle it shut.
    await toggle.click();
    await page.mouse.move(900, 400);
    await expectRailWidth(page, COLLAPSED_W, 'and closes it');

    const cookie = (await context.cookies(ORIGIN)).find((c) => c.name === NAV_COLLAPSED_COOKIE);
    expect(cookie?.value, 'without writing the preference').toBe('0');
  });

  test('none of this applies below md, the drawer still owns that width', async ({ page }) => {
    // Every studio class is `md:`-gated, and under 768px the rail is display:
    // none with the off-canvas drawer in its place, already expanded.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(editUrl);
    await expect(page.locator(MAIN)).toBeVisible({ timeout: 25_000 });
    expect(
      await page.locator(RAIL).evaluate((el) => getComputedStyle(el).display),
      'the desktop rail is out of the tree at 375px',
    ).toBe('none');
  });
});
