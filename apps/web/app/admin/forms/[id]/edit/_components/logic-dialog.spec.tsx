/**
 * Unit tests for the per-question logic dialog's composition decisions — which
 * sections a given step type gets, what the score-context strip reads, and that
 * every edit leaves through the single `onUpdate` callback.
 *
 * The web app's vitest runs in plain node (no jsdom), so these assert on the
 * React element TREE the component returns rather than on rendered markup —
 * the same idiom as `components/tracking/tracking-scripts.spec.tsx`. Playwright
 * drives the real DOM through the `logic-dialog*` testids.
 */
import { describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { FormStep } from '@quill/engine';
import { getMessages } from '@quill/shared';
import { Select } from '@/components/ui/select';
import { LogicDialog } from './logic-dialog';
import { LogicConditions } from './logic-conditions';
import { LogicRules } from './logic-rules';
import { getBuilderMessages, tb } from './builder-messages';

type AnyProps = Record<string, unknown> & { children?: ReactNode };

const bm = getBuilderMessages('en');
const em = getMessages('en').admin.editor;
const d = bm.logicDialog;

/** Depth-first flatten of a React element tree (no rendering, no DOM). */
function collect(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  out.push(node);
  collect((node.props as AnyProps).children, out);
  return out;
}

function byTestId(els: ReactElement[], id: string): ReactElement | undefined {
  return els.find((el) => (el.props as AnyProps)['data-testid'] === id);
}

/** Every string rendered anywhere in the tree (children only, joined). */
function text(els: ReactElement[]): string {
  return els
    .flatMap((el) => {
      const kids = (el.props as AnyProps).children;
      return Array.isArray(kids) ? kids : [kids];
    })
    .filter((c): c is string => typeof c === 'string')
    .join(' | ');
}

const choice = (key: string, points: number[]): FormStep => ({
  key,
  type: 'multiple_choice',
  selectionMode: 'single',
  question: `Pick ${key}`,
  options: points.map((p, i) => ({ label: `Opt ${i}`, value: `${key}_${i}`, points: p })),
});

const scorer = choice('budget', [0, 10, 25]); // max 25

function render(over: {
  step: FormStep;
  index?: number;
  steps?: FormStep[];
  scoringEnabled?: boolean;
  onUpdate?: (patch: Partial<FormStep>) => void;
}): ReactElement[] {
  const steps = over.steps ?? [over.step];
  return collect(
    LogicDialog({
      open: true,
      onClose: () => {},
      step: over.step,
      index: over.index ?? steps.indexOf(over.step),
      steps,
      scoringEnabled: over.scoringEnabled ?? true,
      onUpdate: over.onUpdate ?? (() => {}),
      bm,
      em,
    }),
  );
}

describe('LogicDialog — sections per step type', () => {
  it('gives a scheduler the after-booking picker and NO value-based routing rules', () => {
    const scheduler: FormStep = { key: 'book', type: 'scheduler', question: 'Book a call' };
    const later: FormStep = { key: 'thanks', type: 'message', question: 'Thanks' };
    const els = render({ step: scheduler, steps: [scorer, scheduler, later], index: 1 });

    expect(byTestId(els, 'logic-dialog-booking')).toBeDefined();
    expect(text(els)).toContain(d.booking);
    // A booking has no discrete answer value, so neither the rule editor nor the
    // "no routing here" fallback belongs — the picker IS its routing surface.
    expect(els.some((el) => el.type === LogicRules)).toBe(false);
    expect(byTestId(els, 'logic-dialog-routing')).toBeUndefined();
    expect(byTestId(els, 'logic-dialog-no-routing')).toBeUndefined();
    // Visibility is still offered — a scheduler can be conditional like anything else.
    expect(els.some((el) => el.type === LogicConditions)).toBe(true);
  });

  it('offers only later steps (plus continue / submit) as booking targets', () => {
    const scheduler: FormStep = { key: 'book', type: 'scheduler' };
    const later: FormStep = { key: 'thanks', type: 'message', question: 'Thanks' };
    const els = render({ step: scheduler, steps: [scorer, scheduler, later], index: 1 });

    const picker = byTestId(els, 'logic-dialog-booking-target');
    const select = collect((picker!.props as AnyProps).children).find((el) => el.type === Select)!;
    const options = (select.props as AnyProps).options as { value: string; label: string }[];
    expect(options.map((o) => o.value)).toEqual(['', '__submit__', 'thanks']);
    // The earlier scoring step is NOT a legal forward jump.
    expect(options.some((o) => o.value === scorer.key)).toBe(false);
  });

  it('shows the noRouting copy instead of an empty rule editor for a step that routes nothing', () => {
    // A message card has no answer values to branch on AND records no answer,
    // so `*` could never fire either: NOTHING here can route.
    const note: FormStep = { key: 'note', type: 'message', question: 'Read this' };
    const els = render({ step: note, steps: [scorer, note], index: 1 });

    expect(byTestId(els, 'logic-dialog-no-routing')).toBeDefined();
    expect(text(els)).toContain(d.noRouting);
    expect(els.some((el) => el.type === LogicRules)).toBe(false);
    expect(byTestId(els, 'logic-dialog-always')).toBeUndefined();
    // The misleading "first matching rule wins" hint is suppressed with it.
    expect(text(els)).not.toContain(d.routingHint);
  });

  it('gives a free-text step the Always-go-to select — Branching can write one there', () => {
    const free: FormStep = { key: 'why', type: 'textarea', question: 'Why?' };
    const els = render({ step: free, steps: [scorer, free], index: 1 });

    expect(byTestId(els, 'logic-dialog-always')).toBeDefined();
    // It has no discrete values, so no rule rows — and no lecture about it
    // either, now that the section does offer something.
    expect(els.some((el) => el.type === LogicRules)).toBe(false);
    expect(byTestId(els, 'logic-dialog-no-routing')).toBeUndefined();
  });

  it('renders the real rule editor for a choice step', () => {
    const els = render({ step: scorer });
    expect(byTestId(els, 'logic-dialog-no-routing')).toBeUndefined();
    const rules = els.find((el) => el.type === LogicRules);
    expect(rules).toBeDefined();
    // The step is handed through with only its VALUE rules (it has none here).
    expect((rules!.props as AnyProps).step).toEqual(scorer);
    expect(text(els)).toContain(d.routingHint);
  });

  it('labels itself with the question and carries the Playwright hooks', () => {
    const els = render({ step: scorer });
    expect(byTestId(els, 'logic-dialog')).toBeDefined();
    expect(byTestId(els, 'logic-dialog-close')).toBeDefined();
    // The dialog title comes from the Modal wrapper, interpolated.
    const modal = els[0]!;
    expect((modal.props as AnyProps).title).toBe(tb(d.title, { question: 'Pick budget' }));
    expect((modal.props as AnyProps).labelId).toBe('logic-dialog-title');
  });
});

/**
 * The catch-all (`values: ['*']`, "any answer at all") is writable on every
 * answered step, from either door — this dialog or the form-wide Branching
 * dialog. Both must read and write it the same way, or one silently rewrites
 * what the other stored: handed to the value-rule editor it renders a
 * controlled `<select value="*">` with no matching option (blank), and the
 * first touch turns the author's "always" into a single-value rule.
 */
describe('LogicDialog — the catch-all is a select, never a rule row', () => {
  const later: FormStep = { key: 'later', type: 'message', question: 'Later' };
  /** A choice step with one value rule and an "always → end of form" catch-all. */
  const withCatchAll: FormStep = {
    ...scorer,
    goto: [
      { values: ['budget_1'], target: 'later' },
      { values: ['*'], target: null },
    ],
  };
  const renderCatchAll = (onUpdate?: (patch: Partial<FormStep>) => void) =>
    render({ step: withCatchAll, steps: [withCatchAll, later], index: 0, onUpdate });

  /** The select inside the Always wrapper (the testid is on a wrapper div —
   *  SelectField forwards a fixed prop set and drops testids). */
  function alwaysSelect(els: ReactElement[]): ReactElement | undefined {
    const wrapper = byTestId(els, 'logic-dialog-always');
    if (!wrapper) return undefined;
    return collect((wrapper.props as AnyProps).children).find(
      (el) => typeof (el.props as AnyProps).onChange === 'function',
    );
  }

  it('keeps the catch-all out of the rule editor and reads it back into the select', () => {
    const els = renderCatchAll();
    const rules = els.find((el) => el.type === LogicRules)!;
    expect(((rules.props as AnyProps).step as FormStep).goto).toEqual([{ values: ['budget_1'], target: 'later' }]);
    expect((alwaysSelect(els)!.props as AnyProps).value).toBe('__end__');
  });

  it('offers next-in-order, the later steps and the end of the form as targets', () => {
    const els = renderCatchAll();
    const options = collect((alwaysSelect(els)!.props as AnyProps).children as ReactNode)
      .filter((el) => el.type === 'option')
      .map((el) => (el.props as AnyProps).value);
    expect(options).toEqual(['', 'later', '__end__']);
  });

  it('keeps the catch-all LAST when a value rule changes', () => {
    const onUpdate = vi.fn();
    const els = renderCatchAll(onUpdate);
    const rules = els.find((el) => el.type === LogicRules)!;

    // What LogicRules emits: only the value rules it can see.
    ((rules.props as AnyProps).onUpdate as (p: Partial<FormStep>) => void)({
      goto: [{ values: ['budget_2'], target: 'later' }],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      goto: [
        { values: ['budget_2'], target: 'later' },
        { values: ['*'], target: null },
      ],
    });
  });

  it('keeps the value rules when the Always target changes, and drops only the catch-all on "next in order"', () => {
    const onUpdate = vi.fn();
    const select = alwaysSelect(renderCatchAll(onUpdate))!;
    const onChange = (select.props as AnyProps).onChange as (e: { target: { value: string } }) => void;

    onChange({ target: { value: 'later' } });
    expect(onUpdate).toHaveBeenLastCalledWith({
      goto: [
        { values: ['budget_1'], target: 'later' },
        { values: ['*'], target: 'later' },
      ],
    });

    onChange({ target: { value: '' } });
    expect(onUpdate).toHaveBeenLastCalledWith({ goto: [{ values: ['budget_1'], target: 'later' }] });
  });

  it('ignores a stale catch-all saved on a step that records no answer', () => {
    // The engine matches `*` only when the step recorded an answer, so this
    // jump can never fire: no control offers it, and nothing reports it as a
    // rule — but it stays in the stored config, untouched.
    const note: FormStep = { key: 'note', type: 'message', goto: [{ values: ['*'], target: 'later' }] };
    const els = render({ step: note, steps: [note, later], index: 0 });

    expect(byTestId(els, 'logic-dialog-always')).toBeUndefined();
    expect(byTestId(els, 'logic-dialog-empty')).toBeDefined();
    expect(els.some((el) => el.type === LogicRules)).toBe(false);
  });
});

describe('LogicDialog — score context strip', () => {
  it('reads the highest score reachable BEFORE this step, not the whole form', () => {
    const after = choice('team', [0, 40]); // 40 points, but it comes AFTER
    const target: FormStep = { key: 'why', type: 'textarea' };
    const els = render({ step: target, steps: [scorer, target, after], index: 1 });

    const strip = byTestId(els, 'logic-dialog-score-context')!;
    expect((strip.props as AnyProps).children).toBe(tb(d.scoreContext, { n: 25 }));
  });

  it('falls back to scoreContextNone when nothing above this step awards points', () => {
    const first = choice('budget', [0, 10]);
    const els = render({ step: first, steps: [first], index: 0 });
    expect((byTestId(els, 'logic-dialog-score-context')!.props as AnyProps).children).toBe(
      d.scoreContextNone,
    );
  });

  it('falls back to scoreContextNone when form-level scoring is off', () => {
    const target: FormStep = { key: 'why', type: 'textarea' };
    const els = render({ step: target, steps: [scorer, target], index: 1, scoringEnabled: false });
    expect((byTestId(els, 'logic-dialog-score-context')!.props as AnyProps).children).toBe(
      d.scoreContextNone,
    );
  });

  it('ignores prior steps the runtime never scores (opted out / lead capture)', () => {
    const optedOut: FormStep = { ...choice('a', [0, 50]), scoringEnabled: false };
    const lead: FormStep = { ...choice('b', [0, 50]), flowGroup: 'lead_capture' };
    const target: FormStep = { key: 'why', type: 'textarea' };
    const els = render({ step: target, steps: [optedOut, lead, target], index: 2 });
    expect((byTestId(els, 'logic-dialog-score-context')!.props as AnyProps).children).toBe(
      d.scoreContextNone,
    );
  });
});

describe('LogicDialog — every edit leaves through onUpdate', () => {
  it('writes the scheduler catch-all rule when the after-booking target changes', () => {
    const onUpdate = vi.fn();
    const scheduler: FormStep = { key: 'book', type: 'scheduler' };
    const later: FormStep = { key: 'thanks', type: 'message' };
    const els = render({ step: scheduler, steps: [scheduler, later], index: 0, onUpdate });

    const picker = byTestId(els, 'logic-dialog-booking-target')!;
    const select = collect((picker.props as AnyProps).children).find((el) => el.type === Select)!;
    const onChange = (select.props as AnyProps).onChange as (v: string) => void;

    onChange('thanks');
    expect(onUpdate).toHaveBeenCalledWith({ goto: [{ values: ['*'], target: 'thanks' }] });

    onChange('__submit__');
    expect(onUpdate).toHaveBeenLastCalledWith({ goto: [{ values: ['*'], target: null }] });

    onChange('');
    expect(onUpdate).toHaveBeenLastCalledWith({ goto: undefined });
  });

  it('maps an existing catch-all rule back onto the picker', () => {
    const scheduler: FormStep = { key: 'book', type: 'scheduler', goto: [{ values: ['*'], target: null }] };
    const els = render({ step: scheduler, steps: [scheduler], index: 0 });
    const picker = byTestId(els, 'logic-dialog-booking-target')!;
    const select = collect((picker.props as AnyProps).children).find((el) => el.type === Select)!;
    expect((select.props as AnyProps).value).toBe('__submit__');
  });

  it('patches every child editor straight through to onUpdate (no draft state)', () => {
    const onUpdate = vi.fn();
    const els = render({ step: scorer, onUpdate });

    const conditions = els.find((el) => el.type === LogicConditions)!;
    const rules = els.find((el) => el.type === LogicRules)!;
    expect((conditions.props as AnyProps).onUpdate).toBe(onUpdate);

    // A child editor changing a condition patches straight through, live.
    ((conditions.props as AnyProps).onUpdate as (p: Partial<FormStep>) => void)({
      showWhen: { field: 'budget', values: ['budget_1'] },
    });
    expect(onUpdate).toHaveBeenCalledWith({ showWhen: { field: 'budget', values: ['budget_1'] } });

    // The rule editor's write is the one exception: it only ever sees the VALUE
    // rules, so its patch is re-merged with the catch-all before it leaves —
    // still live, still one `onUpdate`, no draft state.
    ((rules.props as AnyProps).onUpdate as (p: Partial<FormStep>) => void)({
      goto: [{ values: ['budget_1'], target: null }],
    });
    expect(onUpdate).toHaveBeenLastCalledWith({ goto: [{ values: ['budget_1'], target: null }] });
  });

  it('threads the form-level scoring switch into the visibility editor', () => {
    const els = render({ step: scorer, scoringEnabled: false });
    const conditions = els.find((el) => el.type === LogicConditions)!;
    expect((conditions.props as AnyProps).scoringEnabled).toBe(false);
    expect((conditions.props as AnyProps).m).toBe(em.logic);
  });

  it('summarizes a step with no logic at all, and drops the line once a rule exists', () => {
    expect(byTestId(render({ step: scorer }), 'logic-dialog-empty')).toBeDefined();
    const withRule: FormStep = { ...scorer, goto: [{ values: ['budget_1'], target: null }] };
    expect(byTestId(render({ step: withRule }), 'logic-dialog-empty')).toBeUndefined();
  });
});
