import { describe, expect, it } from 'vitest';
import { fitMenu, placeMenu, sameFit, visibleBand, type AncestorBox } from './select-fit';

/**
 * The placement arithmetic on its own, fed made-up geometry. Whether a real
 * browser hands the component the boxes these tests assume is a layout
 * question, and qa/component/select-menu-fit.spec.ts asks it there.
 */
describe('fitMenu', () => {
  const window1440 = { left: 8, right: 1432 };

  it('hangs from the left edge of the trigger when the menu fits there', () => {
    expect(fitMenu(352, { left: 16, right: 236 }, window1440)).toEqual({ side: 'start', width: 352 });
  });

  it('flips to the right edge when the menu only fits leftward', () => {
    expect(fitMenu(352, { left: 1204, right: 1424 }, window1440)).toEqual({ side: 'end', width: 352 });
  });

  it('does not flip when leftward is no better: it narrows on the roomier side', () => {
    // The logic dialog on a 375px phone: a short trigger near the left of a
    // dialog body that is itself narrower than the menu. Flipping here used to
    // put most of the menu off-screen.
    const fit = fitMenu(343, { left: 85, right: 187 }, { left: 49, right: 326 });
    expect(fit).toEqual({ side: 'start', width: 241 });
  });

  it('narrows leftward when that is the roomier side', () => {
    const fit = fitMenu(343, { left: 224, right: 326 }, { left: 49, right: 326 });
    expect(fit).toEqual({ side: 'end', width: 277 });
  });

  it('breaks a tie toward the left edge, the side it has always preferred', () => {
    // The 360px rail: the trigger fills it, so both sides offer the same room.
    expect(fitMenu(352, { left: 681, right: 1008 }, { left: 673, right: 1016 })).toEqual({
      side: 'start',
      width: 335,
    });
  });

  it('never narrows below the trigger, even when the trigger is inside the gutter', () => {
    // A trigger 4px from the clip edge sits inside the 8px gutter. The space
    // under it is still usable, so a menu of its width fits and does not flip.
    const trigger = { left: 100, right: 400 };
    expect(fitMenu(300, trigger, { left: 8, right: 396 })).toEqual({ side: 'start', width: 300 });
    expect(fitMenu(900, { left: 4, right: 396 }, { left: 8, right: 392 })).toEqual({ side: 'start', width: 392 });
  });

  it('does not treat a sub-pixel overhang as an overflow', () => {
    expect(fitMenu(352.3, { left: 1080, right: 1300 }, window1440)).toEqual({ side: 'start', width: 352.3 });
  });
});

/** An ancestor box, in flow and not clipping unless told otherwise. */
const box = (left: number, right: number, over: Partial<AncestorBox> = {}): AncestorBox => ({
  position: 'static',
  overflowX: 'visible',
  inner: { left, right },
  ...over,
});
const scroller = (left: number, right: number, over: Partial<AncestorBox> = {}) =>
  box(left, right, { overflowX: 'auto', ...over });

describe('visibleBand', () => {
  it('is the window less its gutter when nothing clips', () => {
    expect(visibleBand(1440, [])).toEqual({ left: 8, right: 1432 });
    expect(visibleBand(1440, [box(200, 900), box(0, 1440)])).toEqual({ left: 8, right: 1432 });
  });

  it('narrows to a scroll container, gutter included', () => {
    // The 360px settings rail at a 1024px window: 359px inside its border.
    expect(visibleBand(1024, [scroller(665, 1024)])).toEqual({ left: 673, right: 1016 });
  });

  it('intersects nested scroll containers, whichever is tighter on each side', () => {
    const inner = scroller(300, 900);
    const outer = scroller(100, 700);
    expect(visibleBand(1440, [inner, outer])).toEqual({ left: 308, right: 692 });
    // An outer container wider than the inner one changes nothing.
    expect(visibleBand(1440, [inner, scroller(0, 1440)])).toEqual({ left: 308, right: 892 });
  });

  it('reads the computed overflow-x: clipping on the other axis only is not a clip', () => {
    // `overflow-y: clip` leaves overflow-x computing to `visible`.
    expect(visibleBand(1440, [box(300, 900, { overflowX: 'visible' })])).toEqual({ left: 8, right: 1432 });
    // `overflow-y: auto` alone makes overflow-x compute to `auto`; hidden,
    // scroll and clip all cut the menu off just the same.
    for (const overflowX of ['auto', 'hidden', 'scroll', 'clip']) {
      expect(visibleBand(1440, [box(300, 900, { overflowX })])).toEqual({ left: 308, right: 892 });
    }
  });

  it('stops at a fixed overlay: what is above it in the DOM does not clip it', () => {
    // The logic dialog is rendered from inside the settings rail. The rail
    // scrolls, the dialog is `fixed`, and the menu belongs to the dialog.
    const dialogBody = scroller(41, 334);
    const overlay = box(0, 375, { position: 'fixed' });
    const rail = scroller(16, 180);
    expect(visibleBand(375, [dialogBody, overlay, rail])).toEqual({ left: 49, right: 326 });
    // A fixed overlay that itself clips still does.
    expect(visibleBand(375, [box(20, 300, { position: 'fixed', overflowX: 'hidden' }), rail])).toEqual({
      left: 28,
      right: 292,
    });
  });

  it('does not stop at a fixed overlay inside a transformed ancestor', () => {
    // A transform makes its element the containing block of fixed descendants.
    const overlay = box(0, 375, { position: 'fixed' });
    const skipped = scroller(100, 200);
    const transformed = scroller(10, 365, { transformed: true });
    expect(visibleBand(375, [overlay, skipped, transformed])).toEqual({ left: 18, right: 357 });
  });

  it('treats a sticky ancestor like any box in flow: it clips, and so does everything above it', () => {
    const sticky = scroller(260, 1000, { position: 'sticky' });
    const page = scroller(0, 900);
    expect(visibleBand(1440, [sticky, page])).toEqual({ left: 268, right: 892 });
    // Sticky without overflow clips nothing and hides nothing above it.
    expect(visibleBand(1440, [box(260, 1000, { position: 'sticky' }), page])).toEqual({ left: 8, right: 892 });
  });

  it('skips the static ancestors between an absolute box and its containing block', () => {
    const popover = box(400, 800, { position: 'absolute' });
    const staticScroller = scroller(420, 600);
    const positioned = scroller(100, 1000, { position: 'relative' });
    expect(visibleBand(1440, [popover, staticScroller, positioned])).toEqual({ left: 108, right: 992 });
    // The absolute box's own overflow does clip what is inside it.
    expect(visibleBand(1440, [scroller(400, 800, { position: 'absolute' }), staticScroller])).toEqual({
      left: 408,
      right: 792,
    });
  });

  it('ignores an overflow value on a box with no width (display: contents, an inline wrapper)', () => {
    expect(visibleBand(1440, [scroller(500, 500)])).toEqual({ left: 8, right: 1432 });
  });
});

describe('placeMenu', () => {
  it('floors the width at the trigger as it is now, not as it was when the menu opened', () => {
    // Options that ask for 180px under a 336px trigger: the menu matches the
    // trigger. The same options after the trigger shrank to 176px: 180.
    expect(placeMenu(180, { left: 16, right: 352 }, 1440, [])).toEqual({ side: 'start', width: 336 });
    expect(placeMenu(180, { left: 16, right: 192 }, 800, [])).toEqual({ side: 'start', width: 180 });
  });

  it('places against the clipping ancestors, not just the window', () => {
    // 352px of options, a 327px trigger filling the 360px rail.
    expect(placeMenu(352, { left: 681, right: 1008 }, 1024, [scroller(665, 1024)])).toEqual({
      side: 'start',
      width: 335,
    });
    // The same trigger with nothing clipping it flips, as it always has.
    expect(placeMenu(352, { left: 681, right: 1008 }, 1024, [])).toEqual({ side: 'end', width: 352 });
  });
});

describe('sameFit', () => {
  it('tells a placement that changed from one that did not', () => {
    expect(sameFit(null, null)).toBe(true);
    expect(sameFit({ side: 'start', width: 352 }, { side: 'start', width: 352 })).toBe(true);
    expect(sameFit({ side: 'start', width: 352 }, { side: 'end', width: 352 })).toBe(false);
    expect(sameFit({ side: 'start', width: 352 }, { side: 'start', width: 335 })).toBe(false);
    expect(sameFit(null, { side: 'start', width: 352 })).toBe(false);
  });
});
