/**
 * The value-rule rows (#200): a row keeps its OWN current target listed even
 * where the form would not offer it (a question inside a screen, not its
 * first), and only its own, so one stale target never spreads to the other
 * rows; and a new rule starts on a target the form actually offers.
 *
 * Asserted on the element tree LogicRules returns, like the dialog specs.
 */
import { describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { FormStep } from '@quill/engine';
import { LogicRules } from './logic-rules';
import { getBuilderMessages } from './builder-messages';

type AnyProps = Record<string, unknown> & { children?: ReactNode };
const m = getBuilderMessages('en');

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

const field = (key: string, screenGroup?: string): FormStep =>
  ({ key, type: 'text', question: key, ...(screenGroup ? { screenGroup } : {}) }) as FormStep;
const pick: FormStep = {
  key: 'pick',
  type: 'multiple_choice',
  question: 'Pick',
  options: [
    { label: 'A', value: 'a' },
    { label: 'B', value: 'b' },
  ],
  // The first rule still points inside the next screen, past its start.
  goto: [
    { values: ['a'], target: 'zip' },
    { values: ['b'], target: 'last' },
  ],
};
const steps = [pick, field('city', 's'), field('zip', 's'), field('last')];

function render(onUpdate = vi.fn()) {
  return {
    onUpdate,
    els: collect(LogicRules({ step: pick, index: 0, steps, layout: 'slides', onUpdate, m })),
  };
}

/** Each row's target select, as its option values. */
function targetLists(els: ReactElement[]): string[][] {
  return els
    .filter((el) => (el.props as AnyProps)['aria-label'] === m.rules.then)
    .map((select) =>
      collect((select.props as AnyProps).children)
        .filter((el) => el.type === 'option')
        .map((el) => String((el.props as AnyProps).value)),
    );
}

describe('LogicRules targets on a form with screens', () => {
  it('lists a stale target only in the row that holds it', () => {
    const [first, second] = targetLists(render().els);
    expect(first).toEqual(['__end__', 'city', 'zip', 'last']);
    expect(second).toEqual(['__end__', 'city', 'last']);
  });

  it('starts a new rule on a target the form offers', () => {
    const { els, onUpdate } = render();
    // The "Add rule" button: the one control that is not inside a row.
    const add = els.find((el) => String((el.props as AnyProps).className ?? '').includes('self-start'))!;
    ((add.props as AnyProps).onClick as () => void)();
    const goto = (onUpdate.mock.calls[0]![0] as { goto: { target: string | null }[] }).goto;
    expect(goto[2]!.target).toBe('city');
  });
});
