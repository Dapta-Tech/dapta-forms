import { test, expect, type Page } from '@playwright/test';
import { mount } from './mount';

/**
 * Where the shared admin Select puts its menu, and how wide it is.
 *
 * The menu (`apps/web/components/ui/select.tsx`) is `absolute` under its
 * trigger and sized by its longest option, so two things can go wrong that no
 * unit test can see, because both are layout:
 *
 *  1. It lands outside the window, or outside an ancestor that clips it (a
 *     dialog body, the builder's right rail). It used to flip leftward whenever
 *     the right side was too small, without asking whether the left side was
 *     any better.
 *  2. Its width follows the options still in the list, so it changed under the
 *     pointer while you typed in the search box.
 *
 * Each case rebuilds the real container out of the classes that container uses
 * in the app, mounts the real component in it, and asserts on bounding boxes.
 */

const LONG = [
  'Where should we send the onboarding checklist once the kickoff call is booked?',
  'Which of your current tools would you like the new workspace to replace first?',
  'How many people on your team will answer the form before the end of the quarter?',
].map((label, i) => ({ value: `long-${i}`, label }));

const SHORT = ['Email', 'Phone', 'Company', 'Country', 'Job title'].map((label) => ({
  value: label.toLowerCase(),
  label,
}));

interface Spec {
  options: { value: string; label: string }[];
  value?: string;
  searchable?: boolean;
  ariaLabel?: string;
  className?: string;
}

/** A placeholder `entry.tsx` turns into a Select. */
function select(spec: Spec): string {
  const json = JSON.stringify(spec).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
  return `<div data-select='${json}'></div>`;
}

const trigger = (page: Page) => page.locator('button[aria-haspopup="listbox"]');
const listbox = (page: Page) => page.locator('[role="listbox"]');

interface Measured {
  panel: { left: number; right: number; width: number };
  trigger: { left: number; right: number; width: number };
  /** The window's visible width. */
  view: { left: number; right: number };
  /** The inner box of the `[data-clip]` ancestor, or the window when there is none. */
  clip: { left: number; right: number };
  /** Hit tests just inside the menu's left and right edges: is the MENU what is painted there? */
  paintedLeft: boolean;
  paintedRight: boolean;
  pageScrollsSideways: boolean;
  clipScrollsSideways: boolean;
  /** Options cut short instead of wrapped. */
  cutOff: number;
}

async function measure(page: Page): Promise<Measured> {
  return page.evaluate(() => {
    const list = document.querySelector('[role="listbox"]')!;
    const panel = list.parentElement!;
    const box = panel.getBoundingClientRect();
    const button = document.querySelector('button[aria-haspopup="listbox"]')!.getBoundingClientRect();
    const root = document.documentElement;
    const view = { left: 0, right: root.clientWidth };
    const clipEl = document.querySelector<HTMLElement>('[data-clip]');
    let clip = view;
    if (clipEl) {
      const inner = clipEl.getBoundingClientRect().left + clipEl.clientLeft;
      clip = { left: inner, right: inner + clipEl.clientWidth };
    }
    // Probe at a height where the menu shows. This spec is about the horizontal
    // axis: opening scrolls the active option into view, which can move the top
    // of a tall menu out of a short scroll container, and that is not a miss.
    let top = Math.max(box.top, 0);
    let bottom = Math.min(box.bottom, window.innerHeight);
    for (let node = panel.parentElement; node && node !== document.body; node = node.parentElement) {
      if (getComputedStyle(node).overflowY === 'visible') continue;
      const inner = node.getBoundingClientRect().top + node.clientTop;
      top = Math.max(top, inner);
      bottom = Math.min(bottom, inner + node.clientHeight);
    }
    const painted = (x: number) => {
      const hit = document.elementFromPoint(x, (top + bottom) / 2);
      return !!hit && panel.contains(hit);
    };
    const labels = [...list.querySelectorAll<HTMLElement>('[role="option"] span')];
    return {
      panel: { left: box.left, right: box.right, width: box.width },
      trigger: { left: button.left, right: button.right, width: button.width },
      view,
      clip,
      paintedLeft: painted(box.left + 2),
      paintedRight: painted(box.right - 2),
      pageScrollsSideways: root.scrollWidth > root.clientWidth,
      clipScrollsSideways: clipEl ? clipEl.scrollWidth > clipEl.clientWidth : false,
      cutOff: labels.filter(
        (el) => getComputedStyle(el).textOverflow === 'ellipsis' || el.scrollWidth > el.clientWidth + 1,
      ).length,
    };
  });
}

/** Sub-pixel layout: a box may sit a fraction of a pixel over a line it is on. */
const SLACK = 0.5;

/** The whole contract in one place: visible, unclipped, unscrolled, untruncated. */
function expectFullyVisible(m: Measured) {
  expect(m.panel.left, 'menu starts inside the window').toBeGreaterThanOrEqual(m.view.left - SLACK);
  expect(m.panel.right, 'menu ends inside the window').toBeLessThanOrEqual(m.view.right + SLACK);
  expect(m.panel.left, 'menu starts inside its clipping ancestor').toBeGreaterThanOrEqual(m.clip.left - SLACK);
  expect(m.panel.right, 'menu ends inside its clipping ancestor').toBeLessThanOrEqual(m.clip.right + SLACK);
  expect(m.paintedLeft, 'the left edge of the menu is what is painted there').toBe(true);
  expect(m.paintedRight, 'the right edge of the menu is what is painted there').toBe(true);
  expect(m.pageScrollsSideways, 'the page does not scroll sideways').toBe(false);
  expect(m.clipScrollsSideways, 'the clipping ancestor does not scroll sideways').toBe(false);
  expect(m.cutOff, 'no option is cut short').toBe(0);
}

/**
 * The builder's right rail: the third column of the editor grid, and inside it
 * the settings panel, which scrolls (`overflow-y-auto`, and so clips sideways
 * too). At 1024 to 1279px the column is 360px, narrower than the menu's cap.
 */
function rail(spec: Spec): string {
  // The editor grid is `lg:grid-cols-[260px_minmax(0,1fr)_360px]`. The bare,
  // unprefixed class does not exist in the app's sheet, so the columns are
  // spelled out inline; the panel inside carries the app's own classes.
  return `
    <div style="display:grid;grid-template-columns:260px minmax(0,1fr) 360px;height:100vh">
      <div></div><div></div>
      <div data-clip class="flex h-full flex-col gap-5 overflow-y-auto border-l border-border p-4">
        ${select(spec)}
      </div>
    </div>`;
}

/**
 * The per-question logic dialog with one routing rule: `Modal` at `size="lg"`,
 * its scrolling body, the rule card, and the "Then" row whose select lists
 * every later question by its full text.
 */
function logicDialog(spec: Spec): string {
  return `
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div role="dialog" class="relative w-full max-w-2xl rounded-xl border border-border bg-popover p-6 shadow-lg">
        <h2 class="mb-4 text-lg font-semibold">Logic</h2>
        <div data-clip class="flex max-h-[60vh] flex-col gap-5 overflow-y-auto">
          <div class="flex flex-col gap-2 rounded-lg border border-border bg-background p-2.5">
            <div class="flex items-center gap-2">
              <span class="shrink-0 text-xs text-muted-foreground">Then</span>
              ${select(spec)}
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

/** A select of a given width pinned `offset` px from one side of an otherwise empty page. */
function pinned(side: 'left' | 'right', width: number, spec: Spec, offset = 16): string {
  return `<div style="position:absolute;top:40px;${side}:${offset}px;width:${width}px">${select(spec)}</div>`;
}

for (const width of [1024, 1279]) {
  test(`right rail, ${width}px window: a menu wider than the rail stays inside it`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await mount(page, rail({ options: [...SHORT, ...LONG], value: 'email' }));
    await trigger(page).click();
    await expect(listbox(page)).toBeVisible();
    const m = await measure(page);
    // The premise: the rail really is the 360px column (359 inside its border),
    // and the trigger fills it, so the menu's natural width cannot fit.
    expect(m.clip.right - m.clip.left).toBe(359);
    expect(m.trigger.width).toBe(327);
    expectFullyVisible(m);
    expect(m.panel.width, 'the menu still uses the room the rail has').toBeGreaterThanOrEqual(m.trigger.width);
  });
}

for (const width of [375, 414]) {
  test(`logic dialog, ${width}px phone: the "Then" menu with long options stays inside the dialog`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 740 });
    await mount(
      page,
      logicDialog({ options: [{ value: 'end', label: 'Skip to end' }, ...LONG], value: 'end', className: 'h-8 py-1 text-xs' }),
    );
    await trigger(page).click();
    await expect(listbox(page)).toBeVisible();
    const m = await measure(page);
    // The premise: the dialog body is narrower than the menu wants to be.
    expect(m.clip.right - m.clip.left).toBeLessThan(352);
    expectFullyVisible(m);
    // Neither side holds the full menu here, so it narrows and the options
    // wrap: every one is still there in full.
    await expect(listbox(page).getByRole('option')).toHaveCount(4);
    for (const option of LONG) await expect(listbox(page).getByText(option.label)).toBeVisible();
  });
}

for (const width of [375, 414]) {
  test(`logic dialog, ${width}px phone: a long selected option truncates in the trigger, it does not widen it`, async ({
    page,
  }) => {
    // The "Then" select is a flex item sized by its content. With a long option
    // selected, WebKit sized the trigger to the whole label and pushed it (and
    // the menu, which is never narrower than its trigger) out of the dialog.
    await page.setViewportSize({ width, height: 740 });
    await mount(
      page,
      logicDialog({ options: [{ value: 'end', label: 'Skip to end' }, ...LONG], value: 'long-0', className: 'h-8 py-1 text-xs' }),
    );
    const closed = await page.evaluate(() => {
      const clip = document.querySelector<HTMLElement>('[data-clip]')!;
      const button = document.querySelector('button[aria-haspopup="listbox"]')!.getBoundingClientRect();
      const inner = clip.getBoundingClientRect().left + clip.clientLeft;
      return { right: button.right, clipRight: inner + clip.clientWidth, scrolls: clip.scrollWidth > clip.clientWidth };
    });
    expect(closed.right, 'the trigger ends inside the dialog body').toBeLessThanOrEqual(closed.clipRight + SLACK);
    expect(closed.scrolls, 'the dialog body does not scroll sideways').toBe(false);
    await trigger(page).click();
    await expect(listbox(page)).toBeVisible();
    expectFullyVisible(await measure(page));
  });
}

test('1440px window, trigger at the right edge: the menu flips and hangs from the right edge of the trigger', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await mount(page, pinned('right', 220, { options: [...SHORT, ...LONG], value: 'email' }));
  await trigger(page).click();
  const m = await measure(page);
  expectFullyVisible(m);
  expect(m.panel.width, 'grew past the trigger to fit its options').toBeGreaterThan(m.trigger.width + 50);
  expect(Math.abs(m.panel.right - m.trigger.right), 'right edges line up').toBeLessThanOrEqual(SLACK);
});

test('1440px window, trigger at the left edge: the menu hangs from the left edge of the trigger', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await mount(page, pinned('left', 220, { options: [...SHORT, ...LONG], value: 'email' }));
  await trigger(page).click();
  const m = await measure(page);
  expectFullyVisible(m);
  expect(m.panel.width, 'grew past the trigger to fit its options').toBeGreaterThan(m.trigger.width + 50);
  expect(Math.abs(m.panel.left - m.trigger.left), 'left edges line up').toBeLessThanOrEqual(SLACK);
});

test('a menu no wider than its trigger sits exactly under it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await mount(page, pinned('right', 320, { options: SHORT, value: 'email' }));
  await trigger(page).click();
  const m = await measure(page);
  expectFullyVisible(m);
  expect(Math.abs(m.panel.left - m.trigger.left)).toBeLessThanOrEqual(SLACK);
  expect(Math.abs(m.panel.right - m.trigger.right)).toBeLessThanOrEqual(SLACK);
});

test('searchable select in a 250px slot: the menu keeps its width while you type', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await mount(page, pinned('left', 250, { options: [...SHORT, ...LONG], value: 'email', searchable: true }));
  await trigger(page).click();
  const search = page.getByRole('textbox');
  await expect(search).toBeFocused();

  const opened = await measure(page);
  expectFullyVisible(opened);
  expect(opened.panel.width, 'the long options widen the menu past its 250px slot').toBeGreaterThan(300);

  // Each step leaves a different set of options in the list: only short ones,
  // none at all, then every one again.
  for (const query of ['e', 'em', 'emai', 'zzzz', '']) {
    await search.fill(query);
    const m = await measure(page);
    expect(m.panel.width, `width after typing "${query}"`).toBe(opened.panel.width);
    expect(m.panel.left, `left edge after typing "${query}"`).toBe(opened.panel.left);
  }
  await search.fill('zzzz');
  await expect(listbox(page).getByRole('option')).toHaveCount(0);
});

test('a window that shrinks while the menu is open pulls the menu back inside', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await mount(page, pinned('left', 220, { options: [...SHORT, ...LONG], value: 'email' }, 120));
  await trigger(page).click();
  const wide = await measure(page);
  expectFullyVisible(wide);
  await page.setViewportSize({ width: 390, height: 800 });
  await expect.poll(async () => (await measure(page)).panel.right).toBeLessThanOrEqual(390);
  const narrow = await measure(page);
  expectFullyVisible(narrow);
  expect(narrow.panel.width, 'it gave up width to stay inside').toBeLessThan(wide.panel.width);
});

test('a menu as wide as its trigger follows the trigger when the window shrinks', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await mount(page, `<div style="margin:40px 16px 0;width:50vw">${select({ options: SHORT, value: 'email' })}</div>`);
  await trigger(page).click();
  const wide = await measure(page);
  expect(Math.abs(wide.panel.width - wide.trigger.width)).toBeLessThanOrEqual(SLACK);
  await page.setViewportSize({ width: 800, height: 800 });
  await expect.poll(async () => (await measure(page)).panel.width).toBeLessThan(wide.panel.width);
  const narrow = await measure(page);
  expectFullyVisible(narrow);
  expect(Math.abs(narrow.panel.width - narrow.trigger.width), 'still exactly under the trigger').toBeLessThanOrEqual(SLACK);
});

test('a dialog overlay is not narrowed by a scroll container it merely sits in', async ({ page }) => {
  // The overlay is `fixed`: it is laid out against the window, and the narrow
  // scroller around it in the DOM clips nothing of it. Reading that scroller as
  // a clip would squeeze the menu to a sliver for no reason.
  await page.setViewportSize({ width: 1440, height: 800 });
  await mount(
    page,
    `<div style="width:200px;height:300px;overflow:auto">
       <div class="fixed inset-0 flex items-start justify-center" style="padding-top:40px">
         <div style="width:260px">${select({ options: [...SHORT, ...LONG], value: 'email' })}</div>
       </div>
     </div>`,
  );
  await trigger(page).click();
  const m = await measure(page);
  expectFullyVisible(m);
  expect(m.panel.width).toBeGreaterThan(300);
});

test('keyboard: Enter and Space open, arrows move, Enter picks, Esc closes and returns focus', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await mount(page, pinned('left', 250, { options: SHORT, value: 'email' }));
  await trigger(page).focus();

  await page.keyboard.press('Enter');
  await expect(listbox(page)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(listbox(page)).toHaveCount(0);
  await expect(trigger(page)).toHaveText('Company');
  await expect(trigger(page)).toBeFocused();

  await page.keyboard.press('Space');
  await expect(listbox(page)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Escape');
  await expect(listbox(page)).toHaveCount(0);
  await expect(trigger(page)).toHaveText('Company');
  await expect(trigger(page)).toBeFocused();
});

test('keyboard, searchable: typing filters, Enter picks the first match', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await mount(page, pinned('left', 250, { options: [...SHORT, ...LONG], value: 'email', searchable: true }));
  await trigger(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox')).toBeFocused();
  await page.keyboard.type('coun');
  await expect(listbox(page).getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(trigger(page)).toHaveText('Country');
  await expect(trigger(page)).toBeFocused();
});
