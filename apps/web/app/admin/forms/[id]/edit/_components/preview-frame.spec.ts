/**
 * The preview's stepper counts screens (#200): a screen of several questions
 * is one stop, and the frame is asked to start on that screen's first step.
 * A form without screens keeps the step numbers it always had.
 */
import { describe, expect, it } from 'vitest';
import { previewNav } from './preview-frame';

/** Screens as their sizes: `[3, 1, 2]` is a screen of three, one alone, then two. */
const screensOf = (sizes: number[]) => sizes.map((n) => Array.from({ length: n }, (_, i) => i));

describe('previewNav', () => {
  it('walks a form without screens step by step, as before', () => {
    const screens = screensOf([1, 1, 1]);
    const nav = previewNav(screens, 1, false);
    expect(nav).toMatchObject({ total: 3, effectiveScreen: 1, position: 1, canPrev: true, canNext: true });
    expect(nav.target(1)).toBe(2);
    expect(nav.target(-1)).toBe(0);
    // Past the end (steps were deleted): the last one.
    expect(previewNav(screens, 7, false)).toMatchObject({ effectiveScreen: 2, position: 2, canNext: false });
  });

  it('counts a screen of several questions once and starts the frame on its first step', () => {
    const screens = screensOf([3, 1, 2]);
    // A step inside the first screen shows that whole screen.
    expect(previewNav(screens, 1, false)).toMatchObject({ total: 3, effectiveScreen: 0, position: 0 });
    expect(previewNav(screens, 0, false).target(1)).toBe(3);
    expect(previewNav(screens, 3, false).target(1)).toBe(4);
    expect(previewNav(screens, 5, false)).toMatchObject({ effectiveScreen: 4, position: 2, canNext: false });
    expect(previewNav(screens, 4, false).target(-1)).toBe(3);
  });

  it('puts the cover before the first screen when there is one', () => {
    const screens = screensOf([2, 1]);
    expect(previewNav(screens, 'cover', true)).toMatchObject({ effectiveScreen: 'cover', position: -1, canPrev: false });
    expect(previewNav(screens, 'cover', true).target(1)).toBe(0);
    expect(previewNav(screens, 0, true).target(-1)).toBe('cover');
    // No cover: "cover" means the first screen, and there is nothing before it.
    expect(previewNav(screens, 'cover', false)).toMatchObject({ effectiveScreen: 0, position: 0, canPrev: false });
  });

  it('has nothing to walk on an empty form', () => {
    expect(previewNav([], 0, true)).toMatchObject({ total: 0, effectiveScreen: 'cover', canNext: false });
    expect(previewNav([], 0, false)).toMatchObject({ total: 0, effectiveScreen: 0, canNext: false });
  });
});
