/**
 * The builder's rules for screens (#200): which boundaries can be joined and
 * why not, where a dragged question lands, what un-hiding a question does,
 * and where the partial point and a reveal go around a screen.
 */
import { describe, expect, it } from 'vitest';
import { MAX_SCREEN_SIZE, type FormConfig, type FormStep } from '@quill/engine';
import fixtures from '@/app/[accountCode]/[handle]/[slug]/__fixtures__/legacy-configs.json';
import { TEMPLATES } from './templates';
import {
  jumpLanding,
  moveStep,
  onScreen,
  partialAfterScreenMove,
  readsOwnScreen,
  rejoinUnhidden,
  revealSlot,
  screenBoundary,
  screenEnd,
  screenList,
  screenSpanning,
  snapAfterScreen,
  withScreens,
} from './screen-util';

const q = (key: string, screenGroup?: string, extra: Partial<FormStep> = {}): FormStep => ({
  key,
  type: 'text',
  question: key,
  ...(screenGroup ? { screenGroup } : {}),
  ...extra,
});
const keysOf = (steps: FormStep[]) => steps.map((s) => `${s.key}${s.screenGroup ? `:${s.screenGroup}` : ''}`);

describe('screenBoundary', () => {
  const steps = [
    q('a'),
    q('b', 's'),
    q('c', 's'),
    q('h', undefined, { hidden: true }),
    { key: 'meet', type: 'scheduler' } as FormStep,
    q('d'),
  ];

  it('reads a joined boundary, and one that is not', () => {
    expect(screenBoundary(steps, 2)).toEqual({ joined: true, blocked: null });
    expect(screenBoundary(steps, 1)).toEqual({ joined: false, blocked: null });
  });

  it('names why a question cannot join the one above', () => {
    expect(screenBoundary(steps, 0).blocked).toBe('first');
    expect(screenBoundary(steps, 3).blocked).toBe('hidden');
    expect(screenBoundary(steps, 4).blocked).toBe('solo'); // a scheduler never joins
    expect(screenBoundary(steps, 5).blocked).toBe('solo'); // ...nor takes one in
    const full = Array.from({ length: MAX_SCREEN_SIZE }, (_, i) => q(`q${i}`, 'big'));
    expect(screenBoundary([...full, q('more')], MAX_SCREEN_SIZE).blocked).toBe('max');
  });

  it('skips a hidden question above: it is transparent', () => {
    expect(screenBoundary([q('a'), q('h', undefined, { hidden: true }), q('b')], 2).blocked).toBeNull();
  });
});

describe('screenList', () => {
  it('lists each screen once, every other visible question on its own, and no hidden one', () => {
    const steps = [q('a'), q('b', 's'), q('h', undefined, { hidden: true }), q('c', 's'), q('d')];
    expect(screenList(steps)).toEqual([[0], [1, 3], [4]]);
  });
});

describe('moveStep', () => {
  const base = [q('x'), q('a', 's'), q('b', 's'), q('c', 's'), q('y'), q('z')];

  it('reorders within a screen, edges included', () => {
    expect(keysOf(moveStep(base, 1, 3))).toEqual(['x', 'b:s', 'c:s', 'a:s', 'y', 'z']);
    expect(keysOf(moveStep(base, 3, 1))).toEqual(['x', 'c:s', 'a:s', 'b:s', 'y', 'z']);
  });

  it('joins a screen when dropped between two of its questions', () => {
    expect(keysOf(moveStep(base, 4, 2))).toEqual(['x', 'a:s', 'y:s', 'b:s', 'c:s', 'z']);
  });

  it('leaves the screen anywhere else, and a screen of one dissolves', () => {
    // Right after the screen is not inside it.
    expect(keysOf(moveStep(base, 5, 4))).toEqual(['x', 'a:s', 'b:s', 'c:s', 'z', 'y']);
    expect(keysOf(moveStep(base, 3, 5))).toEqual(['x', 'a:s', 'b:s', 'y', 'z', 'c']);
    const pair = [q('a', 's'), q('b', 's'), q('c')];
    expect(keysOf(moveStep(pair, 1, 2))).toEqual(['a', 'c', 'b']);
  });

  it('never joins a solo type, nor a full screen: dropped inside, it lands right after the screen', () => {
    const meet = { key: 'meet', type: 'scheduler' } as FormStep;
    expect(keysOf(moveStep([meet, q('a', 's'), q('b', 's'), q('c')], 0, 1))).toEqual(['a:s', 'b:s', 'meet', 'c']);
    const full = Array.from({ length: MAX_SCREEN_SIZE }, (_, i) => q(`q${i}`, 'big'));
    const moved = moveStep([...full, q('extra')], MAX_SCREEN_SIZE, 1);
    expect(moved.filter((s) => s.screenGroup === 'big')).toHaveLength(MAX_SCREEN_SIZE);
    expect(moved[MAX_SCREEN_SIZE]!.key).toBe('extra');
    expect(moved[MAX_SCREEN_SIZE]!.screenGroup).toBeUndefined();
  });

  it('leaves a hidden question where it was dropped: it cuts nothing', () => {
    const hidden = q('h', undefined, { hidden: true });
    expect(keysOf(moveStep([hidden, q('a', 's'), q('b', 's')], 0, 1))).toEqual(['a:s', 'h', 'b:s']);
  });

  it('keeps the very same array for a no-op move', () => {
    expect(moveStep(base, 2, 2)).toBe(base);
  });
});

describe('rejoinUnhidden', () => {
  it('puts a question shown again back into the screen around it', () => {
    const steps = [q('a', 's'), q('h'), q('b', 's')];
    expect(keysOf(rejoinUnhidden(steps, 1))).toEqual(['a:s', 'h:s', 'b:s']);
  });

  it('leaves it alone when it is not between two questions of one screen', () => {
    const steps = [q('a', 's'), q('b', 's'), q('h')];
    expect(rejoinUnhidden(steps, 2)).toBe(steps);
  });

  it('restores it even to a full screen: it already sat inside it, and leaving it out would cut it', () => {
    const full = Array.from({ length: MAX_SCREEN_SIZE }, (_, i) => q(`q${i}`, 'big'));
    const steps = [...full.slice(0, 5), q('h'), ...full.slice(5)];
    expect(rejoinUnhidden(steps, 5)[5]!.screenGroup).toBe('big');
  });
});

describe('around a screen', () => {
  const steps = [q('a'), q('b', 's'), q('c', 's'), q('d', 's'), q('e')];

  it('screenEnd is the last question of the screen', () => {
    expect(screenEnd(steps, 1)).toBe(3);
    expect(screenEnd(steps, 3)).toBe(3);
    expect(screenEnd(steps, 4)).toBe(4);
  });

  it('the partial point never sits inside a screen', () => {
    expect(snapAfterScreen(steps, 2)).toBe(4); // after b → after d
    expect(snapAfterScreen(steps, 4)).toBe(4);
    expect(snapAfterScreen(steps, 1)).toBe(1);
    expect(snapAfterScreen(steps, undefined)).toBeUndefined();
  });

  it('a hidden question between two of a screen sits inside its span', () => {
    const withHidden = [q('a'), q('b', 's'), q('h', undefined, { hidden: true }), q('c', 's'), q('e')];
    expect(screenSpanning(withHidden, 2)?.members).toEqual([1, 3]);
    expect(screenSpanning(withHidden, 4)).toBeNull();
    expect(screenEnd(withHidden, 2)).toBe(3);
    expect(snapAfterScreen(withHidden, 3)).toBe(4); // after h → after c
  });

  it('a jump into a screen past its start lands mid-screen; into its own screen, nowhere; on slides only', () => {
    expect(jumpLanding(steps, 0, 'c', 'slides')).toBe('mid');
    expect(jumpLanding(steps, 0, 'b', 'slides')).toBeNull();
    expect(jumpLanding(steps, 0, 'e', 'slides')).toBeNull();
    expect(jumpLanding(steps, 1, 'd', 'slides')).toBe('own');
    expect(jumpLanding(steps, 0, 'c', 'vertical')).toBeNull();
    expect(jumpLanding(steps, 1, 'd', 'vertical')).toBeNull();
  });

  it('a reveal after a question of a screen goes after the whole screen', () => {
    const config = { version: 1, steps } as FormConfig;
    expect(revealSlot(config, 1)).toBe(4);
    expect(revealSlot(config, 3)).toBe(4);
    expect(revealSlot(config, 0)).toBe(1);
    expect(revealSlot({ ...config, layout: 'vertical' }, 1)).toBe(2);
  });
});

describe('what a question on a screen should be told', () => {
  const steps = [
    q('a'),
    q('b', 's', { goto: [{ values: ['*'], target: 'e' }] }),
    q('c', 's', { showWhen: { field: 'b', values: ['x'] } }),
    q('d', 's', { showWhen: { field: 'a', values: ['x'] } }),
    q('e', undefined, { hideWhen: { field: 'b', values: ['x'] } }),
  ];

  it('onScreen: a question of a screen of several, on slides only', () => {
    expect([0, 1, 2, 3, 4].map((i) => onScreen(steps, i, 'slides'))).toEqual([false, true, true, true, false]);
    expect(onScreen(steps, 1, 'vertical')).toBe(false);
  });

  it('readsOwnScreen: a show or hide rule that reads a question of the same screen', () => {
    expect(readsOwnScreen(steps, 2, 'slides')).toBe(true);
    expect(readsOwnScreen(steps, 3, 'slides')).toBe(false); // reads the question before the screen
    expect(readsOwnScreen(steps, 4, 'slides')).toBe(false); // not on a screen
    expect(readsOwnScreen(steps, 2, 'vertical')).toBe(false);
  });
});

describe('withScreens: what the editor does to a config on open and on every edit', () => {
  const configs: Array<[string, FormConfig]> = [
    ...Object.entries(fixtures as unknown as Record<string, FormConfig>),
    ...Object.entries(TEMPLATES).map(([id, config]) => [`template ${id}`, config] as [string, FormConfig]),
  ];

  it.each(configs)('keeps the very same %s, on both layouts, so opening it is not an edit', (_name, config) => {
    expect(withScreens(config)).toBe(config);
    const vertical = { ...config, layout: 'vertical' as const };
    expect(withScreens(vertical)).toBe(vertical);
  });

  it('moves a partial point off the inside of a screen on slides, and leaves it on one page', () => {
    const steps = [q('a'), q('b', 's'), q('c', 's'), q('d', 's'), q('e')];
    const slides = { version: 1, steps, partialSubmitAfterStep: 2 } as FormConfig;
    expect(withScreens(slides).partialSubmitAfterStep).toBe(4);
    const vertical = { ...slides, layout: 'vertical' as const };
    expect(withScreens(vertical)).toBe(vertical);
  });

  it('drops an id that makes no screen', () => {
    const config = { version: 1, steps: [q('a', 's'), q('b')] } as FormConfig;
    expect(keysOf(withScreens(config).steps)).toEqual(['a', 'b']);
  });
});

describe('partialAfterScreenMove: the partial point stays with its screen', () => {
  // [intro] [name email phone] [notes], the point after the screen (after phone).
  const before = [q('intro'), q('name', 's'), q('email', 's'), q('phone', 's'), q('notes')];

  it('stays after the screen when its last question is dragged out of it', () => {
    const after = moveStep(before, 3, 4); // phone to the end
    expect(keysOf(after)).toEqual(['intro', 'name:s', 'email:s', 'notes', 'phone']);
    expect(partialAfterScreenMove(4, before, after, 'phone')).toBe(3); // after email
  });

  it('leaves the usual rule alone for a reorder within the screen, or another question moving', () => {
    expect(partialAfterScreenMove(4, before, moveStep(before, 3, 1), 'phone')).toBeNull();
    expect(partialAfterScreenMove(4, before, moveStep(before, 4, 0), 'notes')).toBeNull();
    expect(partialAfterScreenMove(undefined, before, before, 'phone')).toBeNull();
  });
});
