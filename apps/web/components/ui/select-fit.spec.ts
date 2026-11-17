import { describe, expect, it } from 'vitest';
import { fitMenu } from './select-fit';

/**
 * The placement arithmetic on its own. Whether the numbers fed to it are right
 * (the measured width, the clipping ancestors) is a layout question, and
 * qa/component/select-menu-fit.spec.ts asks it in a real browser.
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
