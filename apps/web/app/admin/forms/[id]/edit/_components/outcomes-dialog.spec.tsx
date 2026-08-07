/**
 * Unit tests for the ported outcome table. These pin the BEHAVIOURS the Results
 * tab's version encoded as bug fixes — the unreachable range, the integer
 * `minScore` clamp, and the inert-not-hidden treatment — plus the testids the
 * `v4-save` / `v4-reveal` Playwright specs drive.
 */
import { describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { FormConfig, FormOutcome, FormStep } from '@quill/engine';
import { getMessages } from '@quill/shared';
import { OutcomesDialog } from './outcomes-dialog';
import { getBuilderMessages } from './builder-messages';

type AnyProps = Record<string, unknown> & { children?: ReactNode };

const bm = getBuilderMessages('en');
const rm = getMessages('en').admin.editor.resultsHelp;

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
function allByTestId(els: ReactElement[], id: string): ReactElement[] {
  return els.filter((el) => (el.props as AnyProps)['data-testid'] === id);
}

const outcome = (id: string, minScore: number, over: Partial<FormOutcome> = {}): FormOutcome => ({
  id,
  label: id,
  minScore,
  ...over,
});

const steps: FormStep[] = [{ key: 'email', type: 'email', question: 'Email' }];

const cfg = (outcomes: FormOutcome[], scoring?: boolean): FormConfig => ({
  version: 1,
  steps,
  outcomes,
  scoring: scoring == null ? undefined : { enabled: scoring },
});

function render(over: { config: FormConfig; onOutcomesChange?: (n: FormOutcome[]) => void }): ReactElement[] {
  return collect(
    OutcomesDialog({
      open: true,
      onClose: () => {},
      config: over.config,
      onOutcomesChange: over.onOutcomesChange ?? (() => {}),
      bm,
      rm,
    }),
  );
}

describe('OutcomesDialog — ranges', () => {
  it('sorts by threshold and prints an open-ended top range', () => {
    const els = render({ config: cfg([outcome('hot', 10), outcome('cold', 0)]) });
    const rows = allByTestId(els, 'outcome-row');
    expect(rows).toHaveLength(2);
    // Chip text lives on the span immediately inside each row.
    const chips = rows.map((r) => collect((r.props as AnyProps).children).find((el) => el.type === 'span'));
    expect((chips[0]!.props as AnyProps).children).toBe('0–9');
    expect((chips[1]!.props as AnyProps).children).toBe('10+');
  });

  it('calls a shadowed range UNREACHABLE instead of drawing an inverted span', () => {
    // Two ranges claiming the same threshold used to print "0–-1" as if it were
    // a legitimate bucket.
    const els = render({ config: cfg([outcome('a', 5), outcome('b', 5)]) });
    const rows = allByTestId(els, 'outcome-row');
    expect((rows[0]!.props as AnyProps)['data-unreachable']).toBe(true);
    const chip = collect((rows[0]!.props as AnyProps).children).find((el) => el.type === 'span')!;
    expect((chip.props as AnyProps).children).toBe(bm.results.rangeUnreachable);
    expect((rows[1]!.props as AnyProps)['data-unreachable']).toBeUndefined();
  });

  it('forces minScore to an integer in bounds — a float or exponent broke the whole form’s autosave', () => {
    const onOutcomesChange = vi.fn();
    const els = render({ config: cfg([outcome('a', 0)]), onOutcomesChange });
    const onChange = (byTestId(els, 'outcome-minscore')!.props as AnyProps).onChange as (e: {
      target: { value: string };
    }) => void;

    onChange({ target: { value: '7.5' } });
    expect(onOutcomesChange).toHaveBeenLastCalledWith([expect.objectContaining({ minScore: 7 })]);
    onChange({ target: { value: '1e35' } });
    expect(onOutcomesChange).toHaveBeenLastCalledWith([expect.objectContaining({ minScore: 1_000_000 })]);
    onChange({ target: { value: '' } }); // Number('') is 0, but '-' / 'abc' are NaN
    expect(onOutcomesChange).toHaveBeenLastCalledWith([expect.objectContaining({ minScore: 0 })]);
    onChange({ target: { value: '-' } });
    expect(onOutcomesChange).toHaveBeenLastCalledWith([expect.objectContaining({ minScore: 0 })]);
    // A negative threshold is legitimate — negative points exist.
    onChange({ target: { value: '-3' } });
    expect(onOutcomesChange).toHaveBeenLastCalledWith([expect.objectContaining({ minScore: -3 })]);
  });

  it('removes a range through the same single callback', () => {
    const onOutcomesChange = vi.fn();
    const els = render({ config: cfg([outcome('a', 0), outcome('b', 5)]), onOutcomesChange });
    const remove = els.find((el) => (el.props as AnyProps)['aria-label'] === bm.results.remove)!;
    ((remove.props as AnyProps).onClick as () => void)();
    expect(onOutcomesChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'b' })]);
  });
});

describe('OutcomesDialog — scoring off', () => {
  it('goes inert with the reason stated, and keeps every range on screen', () => {
    const els = render({ config: cfg([outcome('a', 0)], false) });
    const inert = byTestId(els, 'results-outcomes-inert')!;
    expect(inert).toBeDefined();
    expect((inert.props as AnyProps).children).toContain(rm.outcomesInert);
    // Hiding the ranges would read as data loss — they are dimmed, not gone.
    expect(allByTestId(els, 'outcome-row')).toHaveLength(1);
    expect((byTestId(els, 'results-end')!.props as AnyProps)['data-scoring-off']).toBe(true);
    expect(els.some((el) => el.type === 'fieldset' && (el.props as AnyProps).disabled === true)).toBe(true);
  });

  it('is not inert while scoring is on', () => {
    const els = render({ config: cfg([outcome('a', 0)]) });
    expect(byTestId(els, 'results-outcomes-inert')).toBeUndefined();
    expect((byTestId(els, 'results-end')!.props as AnyProps)['data-scoring-off']).toBeUndefined();
  });
});

describe('OutcomesDialog — the fields the Playwright specs drive', () => {
  it('keeps every testid the v4 specs target', () => {
    const els = render({
      config: cfg([
        outcome('a', 0, {
          redirectUrl: 'https://example.com',
          overrides: [{ field: 'budget', values: ['ent'] }],
        }),
      ]),
    });
    for (const id of [
      'results-end',
      'results-add-range',
      'outcome-row',
      'outcome-label',
      'outcome-minscore',
      'outcome-redirect-delay',
      'outcome-override',
    ]) {
      expect(byTestId(els, id), id).toBeDefined();
    }
    // `outcome-message` is a `testId` PROP on TokenTextarea, not a DOM attr.
    expect(els.some((el) => (el.props as AnyProps).testId === 'outcome-message')).toBe(true);
    // `outcome-redirect` sits on the input INSIDE RedirectField, which holds a
    // typing draft in state and so cannot be invoked here — assert the field is
    // mounted and wired; Playwright drives the attribute itself.
    const redirect = els.find((el) => typeof el.type === 'function' && 'onCommit' in (el.props as object))!;
    expect(redirect).toBeDefined();
    expect((redirect.props as AnyProps).value).toBe('https://example.com');
  });

  it('only offers the redirect delay once there is somewhere to redirect to', () => {
    const els = render({ config: cfg([outcome('a', 0)]) });
    expect(byTestId(els, 'outcome-redirect-delay')).toBeUndefined();
  });

  it('reads an answer-forced override back as a sentence and can remove it', () => {
    const onOutcomesChange = vi.fn();
    const els = render({
      config: cfg([
        outcome('a', 0, { overrides: [{ field: 'budget', values: ['ent', 'mid'] }, { field: 'team', maxValue: 5 }] }),
      ]),
      onOutcomesChange,
    });
    const rows = allByTestId(els, 'outcome-override');
    expect(rows).toHaveLength(2);
    const codes = rows.map((r) => collect((r.props as AnyProps).children).find((el) => el.type === 'code')!);
    expect((codes[0]!.props as AnyProps).children).toBe('budget is any of ent, mid');
    expect((codes[1]!.props as AnyProps).children).toBe('team is at most 5');

    const remove = collect((rows[0]!.props as AnyProps).children).find(
      (el) => (el.props as AnyProps)['aria-label'] === rm.overrideRemove,
    )!;
    ((remove.props as AnyProps).onClick as () => void)();
    expect(onOutcomesChange).toHaveBeenCalledWith([
      expect.objectContaining({ overrides: [{ field: 'team', maxValue: 5 }] }),
    ]);
  });

  it('exposes every captured field to the per-outcome recall picker', () => {
    const els = render({ config: cfg([outcome('a', 0)]) });
    const textarea = els.find((el) => (el.props as AnyProps).testId === 'outcome-message')!;
    // The thank-you screen runs AFTER every step, so all keys are offered.
    expect(((textarea.props as AnyProps).tokens as { key: string }[]).map((t) => t.key)).toContain('email');
  });
});
