import { test, expect, type Page } from '@playwright/test';
import { mount } from './mount';

/**
 * The rail's "New workspace" dialog must paint over the page, Home included.
 *
 * The dialog is opened from the workspace switcher, which lives in the rail,
 * and the rail is its own stacking context (`md:sticky` on desktop, a
 * `fixed z-50 translate-x-0` drawer under 768px). A `fixed z-50` overlay left
 * inside it ranks against the rail's children only, so on Home every animated
 * element of the "Connect your agent" card (the tool chips, the mock dF card,
 * the agent's name, the "Done" line; each one carries a transform) painted
 * over the dialog's Name field and Create button, while the page behind still
 * looked dimmed. In the drawer the transform also made the drawer the
 * overlay's containing block, so the "full screen" backdrop was 82vw wide.
 *
 * The assertion is a hit test, as in v9-rail-menus.spec.ts: at the dialog's
 * controls and across a grid over its panel, `document.elementFromPoint` must
 * return the dialog or something inside it. Then the dialog contract: the
 * overlay covers the viewport, focus starts in the dialog and Tab stays in it,
 * the page behind is `aria-hidden`, and Escape closes it.
 *
 * Mounted with the real AdminShell and the real AgentCard (see entry.tsx), in
 * the card's first phase: the answer is on screen, the chips and the mock card
 * mid-entrance, the logos floating.
 */

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

/** The mobile top bar's hamburger, EN and ES (`admin.chrome.openNav`). */
const OPEN_NAV = /open navigation|abrir navegaci/i;

async function openDialog(page: Page, viewport: keyof typeof VIEWPORTS) {
  if (viewport === 'mobile') {
    await page.getByRole('button', { name: OPEN_NAV }).click();
  }
  await page.locator('[data-testid="workspace-switcher-trigger"]:visible').click();
  await page.locator('[data-testid="workspace-create"]').click();
  const dialog = page.locator('[role="dialog"][aria-labelledby="create-workspace-title"]');
  await expect(dialog).toBeVisible();
  return dialog;
}

interface Layering {
  misses: string[];
  overlay: { left: number; top: number; width: number; height: number };
  panelCenter: number;
  view: { width: number; height: number };
  cardUnder: boolean;
}

/** What is painted at the dialog's controls and across its panel. */
async function layering(page: Page): Promise<Layering> {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('[role="dialog"][aria-labelledby="create-workspace-title"]')!;
    const box = panel.getBoundingClientRect();
    const misses: string[] = [];
    const probe = (name: string, x: number, y: number) => {
      const hit = document.elementFromPoint(x, y);
      if (!hit || !panel.contains(hit)) {
        const what = hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 60)}` : 'nothing';
        misses.push(`${name} (${Math.round(x)},${Math.round(y)}) -> ${what}`);
      }
    };
    const centre = (el: Element | null, name: string) => {
      if (!el) return misses.push(`${name} missing`);
      const r = el.getBoundingClientRect();
      probe(name, r.left + r.width / 2, r.top + r.height / 2);
    };
    centre(panel.querySelector('input[name="name"]'), 'name input');
    centre(panel.querySelector('[data-testid="create-workspace-submit"]'), 'create button');
    centre(panel.querySelector('h2'), 'title');
    // A 5x5 grid over the panel, inset off the rounded corners.
    for (let i = 0; i < 5; i += 1) {
      for (let j = 0; j < 5; j += 1) {
        probe(`grid ${i},${j}`, box.left + 12 + ((box.width - 24) * i) / 4, box.top + 12 + ((box.height - 24) * j) / 4);
      }
    }
    const overlay = panel.parentElement!.getBoundingClientRect();
    const card = document.querySelector('[data-testid="home-agent-card"]')!.getBoundingClientRect();
    return {
      misses,
      overlay: { left: overlay.left, top: overlay.top, width: overlay.width, height: overlay.height },
      panelCenter: box.left + box.width / 2,
      view: { width: window.innerWidth, height: window.innerHeight },
      // The check means something only if the demo really sits under the dialog.
      cardUnder:
        card.left < box.right && card.right > box.left && card.top < box.bottom && card.bottom > box.top,
    };
  });
}

for (const viewport of ['desktop', 'mobile'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    for (const locale of ['en', 'es'] as const) {
      test.describe(`new workspace dialog over Home (${viewport}, ${theme}, ${locale})`, () => {
        test.beforeEach(async ({ page }) => {
          await page.setViewportSize(VIEWPORTS[viewport]);
          await mount(page, `<div id="app" data-admin-home='${JSON.stringify({ locale })}'></div>`, theme);
        });

        test('paints over the animated agent card', async ({ page }) => {
          await openDialog(page, viewport);
          const result = await layering(page);
          expect(result.cardUnder, 'the agent card sits under the dialog').toBe(true);
          expect(result.misses).toEqual([]);
          // The backdrop is the whole viewport, not the drawer's box.
          expect(result.overlay).toEqual({ left: 0, top: 0, ...result.view });
          expect(Math.abs(result.panelCenter - result.view.width / 2)).toBeLessThanOrEqual(1);
        });

        test('keeps the dialog contract: focus, Tab trap, aria-hidden page, Escape', async ({ page }) => {
          const dialog = await openDialog(page, viewport);
          await expect(dialog).toHaveAttribute('aria-modal', 'true');
          await expect(dialog.locator('input[name="name"]')).toBeFocused();
          // The app behind (the body child that holds the shell) is hidden from
          // assistive tech while the dialog is up; the dialog itself is not.
          await expect(page.locator('#app')).toHaveAttribute('aria-hidden', 'true');
          for (let i = 0; i < 6; i += 1) {
            await page.keyboard.press('Tab');
            expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
          }
          await page.keyboard.press('Escape');
          await expect(dialog).toHaveCount(0);
          await expect(page.locator('#app')).not.toHaveAttribute('aria-hidden', 'true');
          // Focus goes back to the switcher that opened it, not to <body>.
          await expect(page.locator('[data-testid="workspace-switcher-trigger"]:visible')).toBeFocused();
          if (viewport === 'mobile') {
            // Escape closes the dialog only: the drawer it was opened from stays.
            await expect(page.locator('aside[role="dialog"]')).not.toHaveAttribute('inert', '');
          }
        });
      });
    }
  }
}
