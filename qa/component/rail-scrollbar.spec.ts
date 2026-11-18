import { test, expect, type Page } from '@playwright/test';
import { mount } from './mount';

/**
 * The rail scrolls without drawing a scrollbar.
 *
 * On a short window the rail overflows (under ~690px collapsed, ~660px
 * expanded). A classic scrollbar then drew a gray track down the rail's right
 * edge and took its width out of the column: 11px of a 64px collapsed rail,
 * so every icon slid left the moment the window got short. The rail hides the
 * bar and keeps the scrolling, so nothing becomes unreachable.
 *
 * Playwright's Chromium hides scrollbars by default; that flag is dropped here
 * so the classic bar exists, which is what a "show scroll bars: always" Mac or
 * a Windows/Linux desktop draws.
 */
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

/** The rail on screen: the desktop aside, or the open drawer. */
const RAIL = 'aside:visible';

async function railBox(page: Page) {
  return page.locator(RAIL).first().evaluate((el) => ({
    width: el.offsetWidth,
    // Inner width without the 1px right border: the bar would come out of this.
    inner: el.clientWidth,
    border: parseFloat(getComputedStyle(el).borderRightWidth),
    overflows: el.scrollHeight > el.clientHeight,
    scrollTop: el.scrollTop,
  }));
}

const CASES = [
  { name: 'desktop rail, collapsed', viewport: { width: 1440, height: 600 }, collapsed: true, width: 64 },
  { name: 'desktop rail, expanded', viewport: { width: 1440, height: 600 }, collapsed: false, width: 240 },
  { name: 'mobile drawer', viewport: { width: 390, height: 560 }, collapsed: false, width: 320 },
] as const;

for (const theme of ['light', 'dark'] as const) {
  for (const c of CASES) {
    test.describe(`${c.name} on a short window (${theme})`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize(c.viewport);
        await mount(page, `<div data-admin-home='${JSON.stringify({ locale: 'en', collapsed: c.collapsed })}'></div>`, theme);
        if (c.viewport.width < 768) await page.getByRole('button', { name: /open navigation/i }).click();
      });

      test('overflows, draws no scrollbar, and keeps its full width for its content', async ({ page }) => {
        const box = await railBox(page);
        expect(box.overflows, 'the rail has to overflow for this to mean anything').toBe(true);
        expect(box.width).toBe(c.width);
        expect(box.inner).toBe(box.width - box.border);
      });

      test('still scrolls by wheel and brings a Tab target into view', async ({ page }) => {
        const rail = page.locator(RAIL).first();
        await rail.hover();
        await page.mouse.wheel(0, 400);
        await expect.poll(async () => (await railBox(page)).scrollTop).toBeGreaterThan(0);
        await rail.evaluate((el) => (el.scrollTop = 0));
        // The account menu sits at the very bottom, below the fold. Tab until it
        // has focus: the rail must have scrolled it into view.
        const account = rail.locator('[data-testid="profile-menu-trigger"]');
        for (let i = 0; i < 40; i += 1) {
          if (await account.evaluate((el) => el === document.activeElement)) break;
          await page.keyboard.press(test.info().project.name === 'webkit' ? 'Alt+Tab' : 'Tab');
        }
        await expect(account).toBeFocused();
        const inView = await account.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const a = el.closest('aside')!.getBoundingClientRect();
          return r.top >= a.top - 1 && r.bottom <= a.bottom + 1;
        });
        expect(inView).toBe(true);
      });
    });
  }
}
