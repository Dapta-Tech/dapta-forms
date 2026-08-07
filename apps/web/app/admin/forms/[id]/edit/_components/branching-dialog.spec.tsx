/**
 * Unit tests for the form-wide branching EDITOR (R7): every step in order, each
 * block an inline editor — the universal "Always go to" select, the shared
 * value-rule rows on option types, the shared visibility editors — and no
 * capability lectures anywhere: what a type cannot configure is simply absent.
 *
 * The web app's vitest runs in plain node (no jsdom), so these assert on the
 * React element TREE the component returns rather than on rendered markup —
 * the same idiom as `logic-dialog.spec.tsx`.
 */
import { describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { FormStep } from '@quill/engine';
import { getMessages } from '@quill/shared';
import { LogicDialog } from './logic-dialog';
import { LogicRules } from './logic-rules';
import { LogicConditions } from './logic-conditions';
import { BranchingDialog } from './branching-dialog';
import { getBuilderMessages, tb } from './builder-messages';

type AnyProps = Record<string, unknown> & { children?: ReactNode };

const bm = getBuilderMessages('en');
const em = getMessages('en').admin.editor;

/**
 * Depth-first flatten. Function components declared in THIS file's module (all
 * of which take a `bm` prop) are invoked so their markup is reachable; shared
 * leaves like `LogicRules`, `LogicConditions`, `Button` or `Modal` are left as
 * elements. None of the invoked components use hooks, so calling them is safe.
 */
function collect(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  out.push(node);
  const props = node.props as AnyProps;
  if (
    typeof node.type === 'function' &&
    'bm' in props &&
    node.type !== (LogicRules as unknown) &&
    node.type !== (LogicConditions as unknown)
  ) {
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

const choice = (key: string, question: string): FormStep => ({
  key,
  type: 'multiple_choice',
  selectionMode: 'single',
  question,
  options: [
    { label: 'Enterprise', value: `${key}_ent`, points: 3 },
    { label: 'Startup', value: `${key}_sta`, points: 1 },
  ],
});

function render(over: {
  steps: FormStep[];
  onUpdateStep?: (i: number, patch: Partial<FormStep>) => void;
}): ReactElement[] {
  return collect(
    BranchingDialog({
      open: true,
      onClose: () => {},
      steps: over.steps,
      scoringEnabled: true,
      onUpdateStep: over.onUpdateStep ?? (() => {}),
      bm,
      em,
    }),
  );
}

describe('BranchingDialog — the whole form, in order', () => {
  it('lists every step, numbered by its real position, logic or not', () => {
    const a = choice('budget', 'Budget?');
    const b: FormStep = { key: 'why', type: 'textarea', question: 'Why?' };
    const c = choice('team', 'Team size?');
    const els = render({ steps: [a, b, c] });

    const blocks = allByTestId(els, 'branching-step');
    expect(blocks.map((el) => (el.props as AnyProps)['data-step-key'])).toEqual(['budget', 'why', 'team']);
    expect(allByTestId(els, 'branching-step-number').map((el) => (el.props as AnyProps).children)).toEqual([1, 2, 3]);
  });

  it('counts only the steps that actually carry a rule', () => {
    const plain = choice('budget', 'Budget?');
    const routed: FormStep = { ...choice('team', 'Team size?'), goto: [{ values: ['team_ent'], target: null }] };
    expect((byTestId(render({ steps: [plain, routed] }), 'branching-summary')!.props as AnyProps).children).toBe(
      tb(bm.branching.summary, { n: 1, total: 2 }),
    );
    expect((byTestId(render({ steps: [plain] }), 'branching-summary')!.props as AnyProps).children).toBe(
      bm.branching.summaryNone,
    );
  });

  it('has an empty state for a form with no questions at all', () => {
    const els = render({ steps: [] });
    expect(byTestId(els, 'branching-empty')).toBeDefined();
    expect(allByTestId(els, 'branching-step')).toHaveLength(0);
  });
});

describe('BranchingDialog — every block is the editor (R7)', () => {
  it('gives EVERY question the Always-go-to select, free text included', () => {
    const els = render({
      steps: [choice('budget', 'Budget?'), { key: 'why', type: 'textarea', question: 'Why?' }],
    });
    expect(allByTestId(els, 'branching-always')).toHaveLength(2);
  });

  /** The SelectField element inside an Always wrapper (the testid is on a
   *  wrapper div — SelectField forwards a fixed prop set and drops testids). */
  function selectAt(els: ReactElement[], i: number): ReactElement {
    const wrapper = allByTestId(els, 'branching-always')[i]!;
    const inner = collect((wrapper.props as AnyProps).children as ReactNode);
    return inner.find((el) => typeof (el.props as AnyProps).onChange === 'function')!;
  }

  it('offers only later questions plus End as targets', () => {
    const els = render({ steps: [choice('a', 'A'), choice('b', 'B'), choice('c', 'C')] });
    const options = collect((selectAt(els, 0).props as AnyProps).children as ReactNode)
      .filter((el) => el.type === 'option')
      .map((el) => (el.props as AnyProps).value);
    // "" = next in order, then the two LATER steps, then the end sentinel.
    expect(options).toEqual(['', 'b', 'c', '__end__']);
  });

  it('reads an existing catch-all back into the select', () => {
    const routed: FormStep = { ...choice('a', 'A'), goto: [{ values: ['*'], target: null }] };
    const els = render({ steps: [routed, choice('b', 'B')] });
    expect((selectAt(els, 0).props as AnyProps).value).toBe('__end__');
  });

  it('writes the catch-all LAST so it can never swallow the value rules', () => {
    const onUpdateStep = vi.fn();
    const routed: FormStep = {
      ...choice('a', 'A'),
      goto: [{ values: ['a_ent'], target: 'b' }],
    };
    const els = render({ steps: [routed, choice('b', 'B')], onUpdateStep });
    const select = selectAt(els, 0);
    ((select.props as AnyProps).onChange as (e: { target: { value: string } }) => void)({
      target: { value: '__end__' },
    });
    expect(onUpdateStep).toHaveBeenCalledWith(0, {
      goto: [
        { values: ['a_ent'], target: 'b' },
        { values: ['*'], target: null },
      ],
    });
  });

  it('mounts the SHARED value-rule editor on option types, minus the catch-all row', () => {
    const routed: FormStep = {
      ...choice('a', 'A'),
      goto: [
        { values: ['a_ent'], target: 'b' },
        { values: ['*'], target: null },
      ],
    };
    const els = render({ steps: [routed, choice('b', 'B')] });
    const rules = els.find((el) => el.type === (LogicRules as unknown));
    expect(rules).toBeDefined();
    // The catch-all is the Always-select's business; LogicRules must only see
    // the real value rules or it renders "*" as a broken-looking row.
    expect(((rules!.props as AnyProps).step as FormStep).goto).toEqual([{ values: ['a_ent'], target: 'b' }]);
  });

  it('mounts the SHARED visibility editors from the second step on', () => {
    const els = render({ steps: [choice('a', 'A'), choice('b', 'B')] });
    const conditions = els.filter((el) => el.type === (LogicConditions as unknown));
    expect(conditions).toHaveLength(1); // step 2 only
    expect((conditions[0]!.props as AnyProps).m).toBe(em.logic);
  });

  it('LECTURES NOTHING: a text question shows no rule editor and no explanation why', () => {
    const els = render({ steps: [{ key: 'why', type: 'textarea', question: 'Why?' }] });
    expect(els.find((el) => el.type === (LogicRules as unknown))).toBeUndefined();
    expect(byTestId(els, 'branching-visibility')).toBeUndefined(); // first step: nothing precedes it
    // No "no logic yet" sentence either — the visible controls ARE the state.
    const strings = els
      .flatMap((el) => {
        const kids = (el.props as AnyProps).children;
        return Array.isArray(kids) ? kids : [kids];
      })
      .filter((c): c is string => typeof c === 'string');
    expect(strings).not.toContain(bm.logicDialog.empty);
    expect(strings).not.toContain(em.logic.noPriorFields);
  });

  it('still audits: a step whose rules cancel out is called out', () => {
    const budget = choice('budget', 'Budget?');
    const impossible: FormStep = {
      key: 'demo',
      type: 'message',
      showWhen: { field: 'budget', values: ['budget_ent'] },
      hideWhen: { field: 'budget', values: ['budget_ent'] },
    };
    expect(byTestId(render({ steps: [budget, impossible] }), 'branching-never-appears')).toBeDefined();
  });

  it('labels a scheduler’s row as after-booking, not Always-go-to', () => {
    const scheduler: FormStep = { key: 'book', type: 'scheduler', question: 'Book a call' };
    const els = render({ steps: [choice('a', 'A'), scheduler] });
    const strings = els
      .flatMap((el) => {
        const kids = (el.props as AnyProps).children;
        return Array.isArray(kids) ? kids : [kids];
      })
      .filter((c): c is string => typeof c === 'string');
    expect(strings).toContain(bm.logicDialog.booking);
  });

  it('never mounts LogicDialog — the blocks edit in place now', () => {
    const els = render({ steps: [choice('a', 'A')] });
    expect(els.some((el) => el.type === LogicDialog)).toBe(false);
    expect(byTestId(els, 'branching-edit')).toBeUndefined();
  });
});
