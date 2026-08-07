/**
 * Unit tests for the form-wide branching overview: that it lists EVERY step in
 * order, spells the rules out with the same describer the Logic map uses, says
 * so plainly when a step carries no logic, and hands editing to the parent
 * instead of mounting a second copy of the per-question dialog.
 *
 * The web app's vitest runs in plain node (no jsdom), so these assert on the
 * React element TREE the component returns rather than on rendered markup —
 * the same idiom as `logic-dialog.spec.tsx`.
 */
import { describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { FormStep } from '@quill/engine';
import { LogicDialog } from './logic-dialog';
import { BranchingDialog } from './branching-dialog';
import { getBuilderMessages, tb } from './builder-messages';

type AnyProps = Record<string, unknown> & { children?: ReactNode };

const bm = getBuilderMessages('en');

/**
 * Depth-first flatten. Function components declared in THIS file's module (all
 * of which take a `bm` prop) are invoked so their markup is reachable; shared
 * leaves like `Button` or `Modal` are left as elements. None of the invoked
 * components use hooks, so calling them directly is safe.
 */
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

function render(over: { steps: FormStep[]; onEditStep?: (i: number) => void }): ReactElement[] {
  return collect(
    BranchingDialog({
      open: true,
      onClose: () => {},
      steps: over.steps,
      onEditStep: over.onEditStep ?? (() => {}),
      bm,
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

  it('says a step has no logic in words instead of showing an empty editor', () => {
    const els = render({ steps: [choice('budget', 'Budget?')] });
    expect(byTestId(els, 'branching-step-empty')).toBeDefined();
    expect(text(els)).toContain(bm.logicDialog.empty);
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

describe('BranchingDialog — rules in plain language', () => {
  it('resolves a condition to the QUESTION TITLE and the OPTION LABELS, like the map', () => {
    const budget = choice('budget', 'What is your budget?');
    const gated: FormStep = {
      key: 'demo',
      type: 'message',
      question: 'Book a demo',
      showWhen: { field: 'budget', values: ['budget_ent'] },
    };
    const t = text(render({ steps: [budget, gated] }));

    expect(t).toContain('What is your budget?'); // not the stored key `budget`
    expect(t).toContain('Enterprise'); // not the stored value `budget_ent`
    expect(t).toContain(bm.map.condIn);
    expect(t).toContain(bm.map.condShowIf);
  });

  it('flags a condition pointing at a question that no longer exists', () => {
    const gated: FormStep = {
      key: 'demo',
      type: 'message',
      showWhen: { field: 'deleted_key', values: ['x'] },
    };
    expect(byTestId(render({ steps: [gated] }), 'branching-cond-dangling')).toBeDefined();
  });

  it('calls out a step whose own rules mean it never appears', () => {
    const budget = choice('budget', 'Budget?');
    const impossible: FormStep = {
      key: 'demo',
      type: 'message',
      showWhen: { field: 'budget', values: ['budget_ent'] },
      hideWhen: { field: 'budget', values: ['budget_ent'] },
    };
    const els = render({ steps: [budget, impossible] });
    expect(byTestId(els, 'branching-never-appears')).toBeDefined();
    expect(text(els)).toContain(bm.map.neverAppears);
  });

  it('reads a forward jump with its target question title, and a skip as skip-to-end', () => {
    const budget: FormStep = { ...choice('budget', 'Budget?'), goto: [{ values: ['budget_ent'], target: 'demo' }] };
    const demo: FormStep = { key: 'demo', type: 'message', question: 'Book a demo' };
    expect(text(render({ steps: [budget, demo] }))).toContain(
      tb(bm.map.jumpEdge, { value: 'Enterprise', target: 'Book a demo' }),
    );

    const skip: FormStep = { ...choice('budget', 'Budget?'), goto: [{ values: ['budget_sta'], target: null }] };
    expect(text(render({ steps: [skip] }))).toContain(tb(bm.map.skipEdge, { value: 'Startup' }));
  });

  it('never prints the raw catch-all "*" as if it were an answer', () => {
    const scheduler: FormStep = {
      key: 'book',
      type: 'scheduler',
      question: 'Book a call',
      goto: [{ values: ['*'], target: null }],
    };
    const t = text(render({ steps: [scheduler] }));
    expect(t).toContain(tb(bm.map.skipEdge, { value: bm.branching.anyBooking }));
    expect(t).not.toContain('*');
  });

  it('flags a jump whose target step was deleted', () => {
    const orphan: FormStep = { ...choice('budget', 'Budget?'), goto: [{ values: ['budget_ent'], target: 'gone' }] };
    expect(byTestId(render({ steps: [orphan] }), 'branching-branch-dangling')).toBeDefined();
  });
});

describe('BranchingDialog — editing belongs to the parent', () => {
  it('asks the parent to open the per-question dialog, by index', () => {
    const onEditStep = vi.fn();
    const steps = [choice('a', 'A'), choice('b', 'B'), choice('c', 'C')];
    const els = render({ steps, onEditStep });

    const buttons = allByTestId(els, 'branching-edit');
    expect(buttons).toHaveLength(3);
    ((buttons[2]!.props as AnyProps).onClick as () => void)();
    expect(onEditStep).toHaveBeenCalledWith(2);
  });

  it('never mounts LogicDialog itself — two copies would be two editors of one rule', () => {
    const els = render({ steps: [choice('a', 'A')] });
    expect(els.some((el) => el.type === LogicDialog)).toBe(false);
  });

  it('names the step in the edit control so the button is not just "Edit" to a screen reader', () => {
    const els = render({ steps: [choice('budget', 'What is your budget?')] });
    expect((byTestId(els, 'branching-edit')!.props as AnyProps)['aria-label']).toBe(
      tb(bm.branching.editAria, { question: 'What is your budget?' }),
    );
  });
});
