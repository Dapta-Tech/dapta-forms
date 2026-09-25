/**
 * Screens: several questions on one slides screen (#200).
 *
 * One definition, here in the engine, so the public renderer, the builder and
 * the server score all agree on what a screen is and where a jump lands:
 *
 *  - a screen is a maximal run of consecutive steps (author order) sharing a
 *    `screenGroup`, with two or more members;
 *  - `reveal`, `scheduler` and `file` always stand alone, and a hidden step is
 *    transparent: it never joins a run and never cuts one;
 *  - an id left on one step means nothing, and the same id in two separate
 *    runs makes two screens;
 *  - the one-page layout ignores every id;
 *  - a jump runs when the respondent LEAVES the screen, and a target inside a
 *    screen lands on its first visible question.
 *
 * Absent ids (every config saved before screens existed) must walk exactly as
 * before, which the first block pins.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_SCREEN_SIZE,
  SOLO_SCREEN_TYPES,
  authoredScreens,
  canShareScreen,
  computeScore,
  runtimeScreens,
  runtimeSteps,
  screenIds,
  screensActive,
  type Answers,
  type FormConfig,
  type FormStep,
} from './form-logic';
import {
  migrateRevealToStep,
  normalizeConfig,
  normalizeScreenGroups,
  setScreenBoundary,
} from './form-config';
import { summarizeAnswers } from './answer-summary';
import { summarizeSubmissions } from './submissions-summary';

const step = (p: Partial<FormStep> & Pick<FormStep, 'key' | 'type'>): FormStep => p;
const text = (key: string, screenGroup?: string, extra: Partial<FormStep> = {}): FormStep =>
  step({ key, type: 'text', question: key, ...(screenGroup ? { screenGroup } : {}), ...extra });
const choice = (key: string, screenGroup?: string, extra: Partial<FormStep> = {}): FormStep =>
  step({
    key,
    type: 'multiple_choice',
    question: key,
    options: [
      { label: 'Yes', value: 'yes', points: 5 },
      { label: 'No', value: 'no', points: 1 },
    ],
    ...(screenGroup ? { screenGroup } : {}),
    ...extra,
  });
const cfg = (steps: FormStep[], extra: Partial<FormConfig> = {}): FormConfig => ({ version: 1, steps, ...extra });
const keys = (steps: FormStep[]) => steps.map((s) => s.key);
const screens = (config: FormConfig, answers: Answers = {}) => runtimeScreens(config, answers).map(keys);

describe('legacy configs (no screenGroup anywhere)', () => {
  const legacy: FormConfig[] = [
    cfg([text('a'), choice('b', undefined, { goto: [{ values: ['yes'], target: 'd' }] }), text('c'), text('d')]),
    cfg([
      text('role'),
      text('company', undefined, { showWhen: { field: 'role', values: ['founder'] } }),
      step({ key: 'r', type: 'reveal', reveal: { enabled: true } }),
      step({ key: 'meet', type: 'scheduler' }),
      step({ key: 'cv', type: 'file' }),
      text('email', undefined, { hidden: true }),
    ]),
  ];
  const answers: Answers[] = [{}, { b: 'yes' }, { b: 'no', role: 'founder' }];

  it('every step is its own screen and no step has an id', () => {
    for (const c of legacy) {
      expect([...screenIds(c).values()].every((id) => id === null)).toBe(true);
      expect(authoredScreens(c.steps)).toEqual([]);
      for (const a of answers) {
        expect(runtimeScreens(c, a)).toEqual(runtimeSteps(c, a).map((s) => [s]));
      }
    }
  });

  it('jumps walk exactly as before', () => {
    const c = legacy[0]!;
    expect(keys(runtimeSteps(c, { b: 'yes' }))).toEqual(['a', 'b', 'd']);
    expect(keys(runtimeSteps(c, { b: 'no' }))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('normalizing returns the very same array, so opening a legacy form is not an edit', () => {
    for (const c of legacy) expect(normalizeScreenGroups(c.steps)).toBe(c.steps);
  });
});

describe('what makes a screen', () => {
  it('consecutive steps sharing an id form one screen, with one id per screen', () => {
    const c = cfg([text('a', 's'), text('b', 's'), text('c'), text('d', 't'), text('e', 't')]);
    expect(screens(c)).toEqual([['a', 'b'], ['c'], ['d', 'e']]);
    expect(Object.fromEntries(screenIds(c))).toEqual({ a: 's', b: 's', c: null, d: 't', e: 't' });
  });

  it('a hidden step is transparent: it never joins and never cuts the run', () => {
    const c = cfg([text('a', 's'), text('h', undefined, { hidden: true }), text('b', 's'), text('x', 's', { hidden: true })]);
    expect(screens(c)).toEqual([['a', 'b']]);
    expect(screenIds(c).get('h')).toBeNull();
    expect(screenIds(c).get('x')).toBeNull();
  });

  it('reveal, scheduler and file stand alone even when they carry an id, and cut the run', () => {
    expect([...SOLO_SCREEN_TYPES].sort()).toEqual(['file', 'reveal', 'scheduler']);
    const c = cfg([
      text('a', 's'),
      text('b', 's'),
      step({ key: 'cv', type: 'file', screenGroup: 's' }),
      text('c', 's'),
      step({ key: 'r', type: 'reveal', screenGroup: 's' }),
      text('d', 's'),
      step({ key: 'meet', type: 'scheduler', screenGroup: 's' }),
    ]);
    expect(screens(c)).toEqual([['a', 'b'], ['cv'], ['c'], ['r'], ['d'], ['meet']]);
    expect(screenIds(c).get('c')).toBeNull(); // a run of one is no screen
  });

  it('a message joins, as the screen heading', () => {
    const c = cfg([step({ key: 'hi', type: 'message', question: 'Your details', screenGroup: 's' }), text('a', 's')]);
    expect(screens(c)).toEqual([['hi', 'a']]);
  });

  it('an id left on one step means nothing', () => {
    const c = cfg([text('a', 's'), text('b'), text('c', 't')]);
    expect(screens(c)).toEqual([['a'], ['b'], ['c']]);
    expect([...screenIds(c).values()]).toEqual([null, null, null]);
  });

  it('the same id in two separate runs makes two screens, even when logic hides what sits between', () => {
    const c = cfg([
      text('a', 's'),
      text('b', 's'),
      choice('gate'),
      text('c', 's'),
      text('d', 's', { showWhen: { field: 'gate', values: ['yes'] } }),
      text('e', 's'),
    ]);
    const ids = screenIds(c);
    expect(ids.get('a')).toBe('s');
    expect(ids.get('c')).not.toBe('s');
    expect(ids.get('c')).toBe(ids.get('e'));
    expect(screens(c)).toEqual([['a', 'b'], ['gate'], ['c', 'e']]);
    expect(screens(c, { gate: 'yes' })).toEqual([['a', 'b'], ['gate'], ['c', 'd', 'e']]);
    // Take the step between the runs off the path: the two screens stay two.
    const hiddenGate = cfg(c.steps.map((s) => (s.key === 'gate' ? { ...s, showWhen: { field: 'a', values: ['x'] } } : s)));
    expect(screens(hiddenGate)).toEqual([['a', 'b'], ['c', 'e']]);
  });

  it('logic can leave one member visible: it is still that screen, on its own', () => {
    const c = cfg([choice('a', 's'), text('b', 's', { showWhen: { field: 'a', values: ['yes'] } }), text('c')]);
    expect(screens(c)).toEqual([['a'], ['c']]);
    expect(screenIds(c).get('a')).toBe('s');
    expect(screens(c, { a: 'yes' })).toEqual([['a', 'b'], ['c']]);
  });

  it('the one-page layout ignores every id, and keeps them for a switch back to slides', () => {
    const c = cfg([text('a', 's'), text('b', 's'), text('c')], { layout: 'vertical' });
    expect(screensActive(c)).toBe(false);
    expect([...screenIds(c).values()]).toEqual([null, null, null]);
    expect(screens(c)).toEqual([['a'], ['b'], ['c']]);
    expect(normalizeScreenGroups(c.steps)).toBe(c.steps);
    expect(screensActive({ ...c, layout: 'slides' })).toBe(true);
    expect(screensActive({ ...c, layout: undefined })).toBe(true);
  });

  it('the engine does not cap a screen: the limit is the editor’s', () => {
    expect(MAX_SCREEN_SIZE).toBe(10);
    const many = Array.from({ length: 12 }, (_, i) => text(`q${i}`, 's'));
    expect(screens(cfg(many))).toHaveLength(1);
  });

  it('canShareScreen: never a solo type, never a hidden step', () => {
    expect(canShareScreen(text('a'))).toBe(true);
    expect(canShareScreen(step({ key: 'm', type: 'message' }))).toBe(true);
    expect(canShareScreen(text('a', undefined, { hidden: true }))).toBe(false);
    expect(canShareScreen(step({ key: 'f', type: 'file' }))).toBe(false);
    expect(canShareScreen(step({ key: 'r', type: 'reveal' }))).toBe(false);
    expect(canShareScreen(step({ key: 's', type: 'scheduler' }))).toBe(false);
  });

  it('authoredScreens lists each screen once, with its members in author order', () => {
    const c = cfg([text('a'), text('b', 's'), text('h', undefined, { hidden: true }), text('c', 's'), text('d', 't'), text('e', 't')]);
    expect(authoredScreens(c.steps)).toEqual([
      { id: 's', members: [1, 3] },
      { id: 't', members: [4, 5] },
    ]);
  });
});

describe('jumps on a screen', () => {
  it('a jump from the first member runs when the respondent leaves the screen', () => {
    const c = cfg([
      choice('a', 's', { goto: [{ values: ['yes'], target: 'e' }] }),
      text('b', 's'),
      text('c', 's'),
      text('d'),
      text('e'),
    ]);
    expect(keys(runtimeSteps(c, { a: 'yes' }))).toEqual(['a', 'b', 'c', 'e']);
    expect(screens(c, { a: 'yes' })).toEqual([['a', 'b', 'c'], ['e']]);
    // Without screens the same rule jumps straight away, as it always has.
    const flat = cfg(c.steps.map(({ screenGroup: _drop, ...s }) => s));
    expect(keys(runtimeSteps(flat, { a: 'yes' }))).toEqual(['a', 'e']);
  });

  it('skip to the end from a member ends the form after the screen', () => {
    const c = cfg([choice('a', 's', { goto: [{ values: ['no'], target: null }] }), text('b', 's'), text('c')]);
    expect(keys(runtimeSteps(c, { a: 'no' }))).toEqual(['a', 'b']);
  });

  it('a target inside a screen lands on its first visible question', () => {
    const c = cfg([
      choice('x', undefined, { goto: [{ values: ['yes'], target: 'c' }] }),
      text('y'),
      text('b', 's', { showWhen: { field: 'x', values: ['no'] } }),
      text('c', 's'),
      text('d', 's'),
    ]);
    // b is hidden when x = yes, so the screen's first visible question is c.
    expect(keys(runtimeSteps(c, { x: 'yes' }))).toEqual(['x', 'c', 'd']);
    const open = cfg(c.steps.map((s) => (s.key === 'b' ? { ...s, showWhen: null } : s)));
    expect(keys(runtimeSteps(open, { x: 'yes' }))).toEqual(['x', 'b', 'c', 'd']);
  });

  it('a target on the same screen is ignored and the walk continues after it', () => {
    const forward = cfg([choice('a', 's', { goto: [{ values: ['yes'], target: 'b' }] }), text('b', 's'), text('c')]);
    expect(keys(runtimeSteps(forward, { a: 'yes' }))).toEqual(['a', 'b', 'c']);
    const back = cfg([text('a', 's'), choice('b', 's', { goto: [{ values: ['yes'], target: 'a' }] }), text('c')]);
    expect(keys(runtimeSteps(back, { b: 'yes' }))).toEqual(['a', 'b', 'c']);
  });

  it('with several matching rules on one screen, the first from the top wins', () => {
    const c = cfg([
      choice('a', 's', { goto: [{ values: ['yes'], target: 'd' }] }),
      choice('b', 's', { goto: [{ values: ['yes'], target: 'e' }] }),
      text('c'),
      text('d'),
      text('e'),
    ]);
    expect(keys(runtimeSteps(c, { a: 'yes', b: 'yes' }))).toEqual(['a', 'b', 'd', 'e']);
    expect(keys(runtimeSteps(c, { a: 'no', b: 'yes' }))).toEqual(['a', 'b', 'e']);
  });

  it('jumps are still forward only: a target on an earlier screen is ignored', () => {
    const c = cfg([text('a', 's'), text('b', 's'), choice('c', 't', { goto: [{ values: ['yes'], target: 'a' }] }), text('d', 't'), text('e')]);
    expect(keys(runtimeSteps(c, { c: 'yes' }))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('the server score counts what the respondent saw: the rest of the screen, not what the jump skipped', () => {
    const c = cfg(
      [
        choice('a', 's', { goto: [{ values: ['yes'], target: 'd' }] }),
        choice('b', 's'),
        choice('c'),
        choice('d'),
      ],
      { scoring: { enabled: true } },
    );
    // a(5) + b(5) + d(5); c was jumped over.
    expect(computeScore(c, { a: 'yes', b: 'yes', c: 'yes', d: 'yes' })).toBe(15);
  });
});

describe('normalizeScreenGroups', () => {
  it('keeps a canonical config as the very same array', () => {
    const steps = [text('a', 's'), text('b', 's'), text('c'), text('d', 't'), text('e', 't')];
    expect(normalizeScreenGroups(steps)).toBe(steps);
  });

  it('drops the id on solo types, hidden steps and single steps, and touches nothing else', () => {
    const steps = [
      text('a', 's'),
      text('b', 's'),
      text('h', 's', { hidden: true }),
      step({ key: 'cv', type: 'file', screenGroup: 's' }),
      text('lone', 'u'),
      text('c'),
    ];
    const out = normalizeScreenGroups(steps);
    expect(out.map((s) => s.screenGroup)).toEqual(['s', 's', undefined, undefined, undefined, undefined]);
    expect(out.every((s) => !('screenGroup' in s) || s.screenGroup)).toBe(true);
    expect(out[0]).toBe(steps[0]);
    expect(out[5]).toBe(steps[5]);
  });

  it('re-issues an id repeated in a separate run, and is idempotent', () => {
    const steps = [text('a', 's'), text('b', 's'), text('x'), text('c', 's'), text('d', 's')];
    const once = normalizeScreenGroups(steps);
    expect(once.map((s) => s.screenGroup)).toEqual(['s', 's', undefined, 'screen_1', 'screen_1']);
    expect(normalizeScreenGroups(once)).toBe(once);
  });

  it('a re-issued id never collides with one the form already uses', () => {
    const steps = [text('a', 'screen_1'), text('b', 'screen_1'), text('x'), text('c', 'screen_1'), text('d', 'screen_1'), text('e', 'screen_2'), text('f', 'screen_2')];
    expect(normalizeScreenGroups(steps).map((s) => s.screenGroup)).toEqual([
      'screen_1',
      'screen_1',
      undefined,
      'screen_3',
      'screen_3',
      'screen_2',
      'screen_2',
    ]);
  });

  it('runs inside normalizeConfig, so a save never stores a broken screen', () => {
    const out = normalizeConfig(cfg([text('a', 's'), text('b', 's'), text('c', 'lone')]));
    expect(out.steps.map((s) => s.screenGroup)).toEqual(['s', 's', undefined]);
    const legacy = normalizeConfig(cfg([text('a'), text('b')]));
    expect(legacy.steps.every((s) => !('screenGroup' in s))).toBe(true);
  });
});

describe('setScreenBoundary', () => {
  it('joins a question to the one above, on a new screen', () => {
    const c = cfg([text('a'), text('b'), text('c')]);
    const out = setScreenBoundary(c, 1, true);
    expect(screens(out)).toEqual([['a', 'b'], ['c']]);
    expect(out.steps.map((s) => s.screenGroup)).toEqual(['screen_1', 'screen_1', undefined]);
  });

  it('joining merges the two whole screens and keeps the upper id', () => {
    const c = cfg([text('a', 's'), text('b', 's'), text('c', 't'), text('d', 't')]);
    const out = setScreenBoundary(c, 2, true);
    expect(screens(out)).toEqual([['a', 'b', 'c', 'd']]);
    expect(new Set(out.steps.map((s) => s.screenGroup))).toEqual(new Set(['s']));
  });

  it('splits a screen at the question, and a part left alone is no screen', () => {
    const c = cfg([text('a', 's'), text('b', 's'), text('c', 's')]);
    expect(screens(setScreenBoundary(c, 2, false))).toEqual([['a', 'b'], ['c']]);
    const out = setScreenBoundary(c, 1, false);
    expect(screens(out)).toEqual([['a'], ['b', 'c']]);
    expect(out.steps[0]!.screenGroup).toBeUndefined();
  });

  it('skips a hidden question above: it is transparent', () => {
    const c = cfg([text('a'), text('h', undefined, { hidden: true }), text('b')]);
    expect(screens(setScreenBoundary(c, 2, true))).toEqual([['a', 'b']]);
  });

  it('respects the cap', () => {
    const nine = Array.from({ length: 9 }, (_, i) => text(`q${i}`, 's'));
    const c = cfg([...nine, text('ten'), text('eleven')]);
    const ten = setScreenBoundary(c, 9, true);
    expect(screens(ten)[0]).toHaveLength(10);
    expect(setScreenBoundary(ten, 10, true)).toBe(ten);
  });

  it('refuses solo types, hidden questions and the first question, returning the config untouched', () => {
    const c = cfg([
      text('a'),
      step({ key: 'meet', type: 'scheduler' }),
      text('b'),
      text('h', undefined, { hidden: true }),
      step({ key: 'r', type: 'reveal' }),
      text('c'),
    ]);
    expect(setScreenBoundary(c, 0, true)).toBe(c); // nothing above
    expect(setScreenBoundary(c, 1, true)).toBe(c); // a scheduler never joins
    expect(setScreenBoundary(c, 2, true)).toBe(c); // ...nor takes a question in
    expect(setScreenBoundary(c, 3, true)).toBe(c); // a hidden question
    expect(setScreenBoundary(c, 5, true)).toBe(c); // the reveal above
    expect(setScreenBoundary(c, 9, true)).toBe(c); // out of range
  });

  it('is a no-op when the boundary is already what was asked for', () => {
    const c = cfg([text('a', 's'), text('b', 's'), text('c')]);
    expect(setScreenBoundary(c, 1, true)).toBe(c);
    expect(setScreenBoundary(c, 2, false)).toBe(c);
  });
});

describe('a legacy reveal on a screen member', () => {
  it('becomes a reveal step after the whole screen, so the screen is not cut', () => {
    const c = cfg([text('a', 's'), text('b', 's'), text('c')], { reveal: { enabled: true }, revealAfterStep: 1 });
    const out = migrateRevealToStep(c);
    expect(out.steps.map((s) => s.type)).toEqual(['text', 'text', 'reveal', 'text']);
    expect(screens(out)).toEqual([['a', 'b'], [out.steps[2]!.key], ['c']]);
  });
});

describe('everything downstream of the config reads per question, unchanged', () => {
  const flat = cfg([
    step({ key: 'name', type: 'name', question: 'Your name?' }),
    step({ key: 'email', type: 'email', question: 'Email?' }),
    choice('fit'),
    text('notes'),
  ]);
  const grouped = cfg(flat.steps.map((s, i) => (i < 3 ? { ...s, screenGroup: 's' } : s)));
  const answers: Answers = { firstname: 'Ana', lastname: 'Ruiz', email: 'ana@example.com', fit: 'yes', notes: 'hi' };

  it('the answers in the emails and the Summary tab are the same with or without screens', () => {
    expect(screens(grouped)).toEqual([['name', 'email', 'fit'], ['notes']]);
    expect(summarizeAnswers(grouped, answers)).toEqual(summarizeAnswers(flat, answers));
    const rows = [{ id: 'r1', data: answers, at: 1 }];
    expect(summarizeSubmissions(grouped.steps, rows)).toEqual(summarizeSubmissions(flat.steps, rows));
  });
});
