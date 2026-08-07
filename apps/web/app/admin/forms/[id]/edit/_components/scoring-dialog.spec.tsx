/**
 * Unit tests for the form-wide scoring editor: that points are EDITABLE (the
 * thing that does not exist anywhere else), that negatives survive, that no
 * non-finite value can reach the config, and that a slider — which scores by
 * range, not by option — gets the range editor instead of an empty option list.
 *
 * Element-tree assertions, no DOM: the web app's vitest runs in plain node.
 */
import { describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { FormConfig, FormStep } from '@quill/engine';
import { getMessages } from '@quill/shared';
import { SliderScoringEditor } from './slider-scoring-editor';
import { ScoringDialog, commitPoints } from './scoring-dialog';
import { getBuilderMessages, tb } from './builder-messages';

type AnyProps = Record<string, unknown> & { children?: ReactNode };

const bm = getBuilderMessages('en');
const em = getMessages('en').admin.editor;

/** Depth-first flatten; this file's own sub-components (they take `bm`) are
 *  invoked so their markup is reachable. None of them use hooks. */
function collect(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  out.push(node);
  const props = node.props as AnyProps;
  if (typeof node.type === 'function' && 'bm' in props) {
    collect((node.type as (p: AnyProps) => ReactNode)(props), out);
  }
  collect(props.children, out);
  return out;
}

function byTestId(els: ReactElement[], id: string): ReactElement | undefined {
  return els.find((el) => (el.props as AnyProps)['data-testid'] === id);
}
function allByTestId(els: ReactElement[], id: string): ReactElement[] {
  return els.filter((el) => (el.props as AnyProps)['data-testid'] === id);
}

const choice = (key: string, points: number[]): FormStep => ({
  key,
  type: 'multiple_choice',
  selectionMode: 'single',
  question: `Pick ${key}`,
  options: points.map((p, i) => ({ label: `Opt ${i}`, value: `${key}_${i}`, points: p })),
});

const cfg = (steps: FormStep[], scoring?: boolean): FormConfig => ({
  version: 1,
  steps,
  scoring: scoring == null ? undefined : { enabled: scoring },
});

function render(over: {
  config: FormConfig;
  onScoringChange?: (on: boolean) => void;
  onStepScoringChange?: (i: number, on: boolean) => void;
  onStepPatch?: (i: number, patch: Partial<FormStep>) => void;
}): ReactElement[] {
  return collect(
    ScoringDialog({
      open: true,
      onClose: () => {},
      config: over.config,
      onScoringChange: over.onScoringChange ?? (() => {}),
      onStepScoringChange: over.onStepScoringChange ?? (() => {}),
      onStepPatch: over.onStepPatch ?? (() => {}),
      bm,
      em,
    }),
  );
}

describe('commitPoints — the guard that keeps autosave alive', () => {
  it('keeps NEGATIVE points (the real forms use −2 … +3)', () => {
    expect(commitPoints('-2')).toBe(-2);
    expect(commitPoints('-1')).toBe(-1);
    expect(commitPoints('3')).toBe(3);
  });

  it('never lets a non-finite value through', () => {
    // Everything a keyboard produces mid-typing. One of these landing in the
    // config fails schema validation and stops the WHOLE form autosaving.
    expect(commitPoints('')).toBe(0);
    expect(commitPoints('-')).toBe(0);
    expect(commitPoints('abc')).toBe(0);
    expect(commitPoints('1e999')).toBe(0); // Infinity
  });

  it('forces an integer in bounds', () => {
    expect(commitPoints('7.9')).toBe(7);
    expect(commitPoints('-7.9')).toBe(-7);
    expect(commitPoints('1e35')).toBe(1_000_000);
    expect(commitPoints('-1e35')).toBe(-1_000_000);
  });
});

describe('ScoringDialog — the points are editable here', () => {
  it('renders an input per option and patches the FULL options array on edit', () => {
    const onStepPatch = vi.fn();
    const q = choice('budget', [0, 2]);
    const els = render({ config: cfg([q]), onStepPatch });

    const inputs = allByTestId(els, 'points-option-input');
    expect(inputs).toHaveLength(2);

    const onChange = (inputs[1]!.props as AnyProps).onChange as (e: { target: { value: string } }) => void;
    onChange({ target: { value: '-2' } });
    expect(onStepPatch).toHaveBeenCalledWith(0, {
      options: [
        { label: 'Opt 0', value: 'budget_0', points: 0 },
        { label: 'Opt 1', value: 'budget_1', points: -2 },
      ],
    });
  });

  it('patches by the step’s index in the FULL step list, not the filtered one', () => {
    const onStepPatch = vi.fn();
    const lead: FormStep = { key: 'email', type: 'email', question: 'Email' };
    const q = choice('budget', [5]);
    // `email` is not a scoring step, so `budget` is index 1 overall but 0 in the list.
    const els = render({ config: cfg([lead, q]), onStepPatch });

    const input = byTestId(els, 'points-option-input')!;
    ((input.props as AnyProps).onChange as (e: { target: { value: string } }) => void)({ target: { value: '9' } });
    expect(onStepPatch).toHaveBeenCalledWith(1, { options: [{ label: 'Opt 0', value: 'budget_0', points: 9 }] });
  });

  it('numbers a question by its real position — a scored slider at question 5 reads "5"', () => {
    const filler: FormStep[] = [1, 2, 3, 4].map((n) => ({ key: `f${n}`, type: 'text', question: `F${n}` }));
    const slider: FormStep = { key: 'rate', type: 'slider', question: 'Rate us', min: 0, max: 10 };
    const els = render({ config: cfg([...filler, slider]) });
    expect(allByTestId(els, 'points-question-number').map((el) => (el.props as AnyProps).children)).toEqual([5]);
  });

  it('states the highest possible total, and each question’s own ceiling', () => {
    const els = render({ config: cfg([choice('a', [0, 3]), choice('b', [0, 2])]) });
    expect((byTestId(els, 'scoring-total')!.props as AnyProps).children).toBe(tb(bm.results.pointsHint, { n: 5 }));
    expect(allByTestId(els, 'points-card-max').map((el) => (el.props as AnyProps).children)).toEqual([
      tb(bm.scoring.stepMax, { n: 3 }),
      tb(bm.scoring.stepMax, { n: 2 }),
    ]);
  });
});

describe('ScoringDialog — a slider scores by RANGE, not by option', () => {
  it('gives a slider the range editor and no option rows', () => {
    const slider: FormStep = {
      key: 'rate',
      type: 'slider',
      question: 'Rate us',
      min: 0,
      max: 10,
      sliderScoring: [{ min: 8, max: 10, points: 3 }],
    };
    const els = render({ config: cfg([slider]) });

    expect(byTestId(els, 'points-slider')).toBeDefined();
    expect(allByTestId(els, 'points-option-input')).toHaveLength(0);
    const editor = els.find((el) => el.type === SliderScoringEditor)!;
    expect(editor).toBeDefined();
    expect((editor.props as AnyProps).ranges).toEqual([{ min: 8, max: 10, points: 3 }]);
    expect((editor.props as AnyProps).m).toBe(em.sliderScoring);
  });

  it('writes a range change back as sliderScoring on the right step', () => {
    const onStepPatch = vi.fn();
    const slider: FormStep = { key: 'rate', type: 'slider', min: 0, max: 10 };
    const els = render({ config: cfg([choice('a', [1]), slider]), onStepPatch });
    const editor = els.find((el) => el.type === SliderScoringEditor)!;
    ((editor.props as AnyProps).onChange as (r: unknown) => void)([{ min: 0, max: 5, points: 1 }]);
    expect(onStepPatch).toHaveBeenCalledWith(1, { sliderScoring: [{ min: 0, max: 5, points: 1 }] });
  });

  it('says so when a choice question has no options to score yet', () => {
    const bare: FormStep = { key: 'pick', type: 'dropdown', question: 'Pick', options: [] };
    expect(byTestId(render({ config: cfg([bare]) }), 'points-no-options')).toBeDefined();
  });
});

describe('ScoringDialog — the two scoring switches', () => {
  it('carries the form-level switch and reports the off state without promising a total', () => {
    const onScoringChange = vi.fn();
    const els = render({ config: cfg([choice('a', [3])], false), onScoringChange });

    const toggle = byTestId(els, 'scoring-dialog-toggle')!;
    expect((toggle.props as AnyProps).checked).toBe(false);
    ((toggle.props as AnyProps).onCheckedChange as (v: boolean) => void)(true);
    expect(onScoringChange).toHaveBeenCalledWith(true);
    expect((byTestId(els, 'scoring-total')!.props as AnyProps).children).toBe(bm.results.pointsHintOff);
  });

  it('goes inert with the reason stated rather than HIDING the points', () => {
    const els = render({ config: cfg([choice('a', [3])], false) });
    expect(byTestId(els, 'scoring-inert')).toBeDefined();
    // The table a user typed is still on screen — hiding it reads as data loss.
    expect(allByTestId(els, 'points-card')).toHaveLength(1);
    expect(allByTestId(els, 'points-option-input')).toHaveLength(1);
  });

  it('keeps an opted-out question listed (you need to see it to turn it back on)', () => {
    const onStepScoringChange = vi.fn();
    const off: FormStep = { ...choice('a', [3]), scoringEnabled: false };
    const els = render({ config: cfg([off]), onStepScoringChange });

    const card = byTestId(els, 'points-card')!;
    expect((card.props as AnyProps)['data-scoring-off']).toBe(true);
    const toggle = byTestId(els, 'points-card-toggle')!;
    expect((toggle.props as AnyProps).checked).toBe(false);
    ((toggle.props as AnyProps).onCheckedChange as (v: boolean) => void)(true);
    expect(onStepScoringChange).toHaveBeenCalledWith(0, true);
  });

  it('has an empty state when nothing in the form can score', () => {
    const els = render({ config: cfg([{ key: 'why', type: 'textarea', question: 'Why?' }]) });
    expect(byTestId(els, 'scoring-empty')).toBeDefined();
    expect(allByTestId(els, 'points-card')).toHaveLength(0);
  });
});
