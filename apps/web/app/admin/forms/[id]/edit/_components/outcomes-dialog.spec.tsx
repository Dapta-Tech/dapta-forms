/**
 * Unit tests for the outcome table. These pin the BEHAVIOURS it encodes as bug
 * fixes — the refused overlap, the announced gap, the integer bound clamp, and
 * the inert-not-hidden treatment — plus the testids the `v4-save` / `v4-reveal`
 * Playwright specs drive.
 *
 * The two bounds live in `RangeBounds`, a child that holds a typing draft in
 * state and so cannot be invoked from here — same as `RedirectField`. What CAN
 * be reached is its `onCommit` prop, which is the whole veto: it either writes
 * and returns null, or refuses and returns the reason. That is the contract
 * tested below; Playwright drives the inputs themselves.
 */
import { describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { FormConfig, FormOutcome, FormStep } from '@quill/engine';
import { getMessages } from '@quill/shared';
import { OutcomesDialog, ScoreBar, firstClash, segmentLabel, spanText, toStoredInt } from './outcomes-dialog';
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

/** The `RangeBounds` elements, in row order — the bounds live inside them. */
function bounds(els: ReactElement[]): AnyProps[] {
  return els.filter((el) => 'openEnded' in (el.props as object)).map((el) => el.props as AnyProps);
}
/** Commit a bound on row `index` the way the field does, and report the refusal. */
function commit(els: ReactElement[], index: number, patch: Partial<FormOutcome>): string | null {
  const onCommit = bounds(els)[index]!.onCommit as (p: Partial<FormOutcome>) => string | null;
  return onCommit(patch);
}

describe('spanText / firstClash / toStoredInt', () => {
  it('reads a span the way the author typed it, and the open one as open', () => {
    expect(spanText({ min: -8, max: -1 })).toBe('-8–-1');
    expect(spanText({ min: 6, max: null })).toBe('6+');
    // One score wide reads as that score — "no range covers 2–2" is not English.
    expect(spanText({ min: 2, max: 2 })).toBe('2');
  });

  it('names the range a span would collide with', () => {
    const clash = firstClash([outcome('a', 0, { maxScore: 5, label: 'Nurture' }), outcome('b', 4, { maxScore: 9 })], 1);
    expect(clash).toEqual({ label: 'Nurture', range: '0–5' });
  });

  it('falls back to #n so the refusal is still a sentence for an unnamed range', () => {
    const els = [outcome('a', 0, { maxScore: 5, label: '' }), outcome('b', 4, { maxScore: 9 })];
    expect(firstClash(els, 1)?.label).toBe('#1');
  });

  it('finds no clash between ranges that merely touch', () => {
    expect(firstClash([outcome('a', 0, { maxScore: 5 }), outcome('b', 6, { maxScore: 9 })], 1)).toBeNull();
  });

  it('forces a bound to an integer in range — a float or exponent broke the whole form’s autosave', () => {
    expect(toStoredInt('7.5')).toBe(7);
    expect(toStoredInt('1e35')).toBe(1_000_000);
    expect(toStoredInt('')).toBe(0); // Number('') is 0, but '-' / 'abc' are NaN
    expect(toStoredInt('-')).toBe(0);
    expect(toStoredInt('abc')).toBe(0);
    // A negative threshold is legitimate — negative points exist.
    expect(toStoredInt('-3')).toBe(-3);
  });
});

describe('OutcomesDialog — ranges', () => {
  it('gives every row two bounds and leaves the top one open', () => {
    const els = render({ config: cfg([outcome('hot', 10), outcome('cold', 0)]) });
    expect(allByTestId(els, 'outcome-row')).toHaveLength(2);
    // Sorted by threshold, so the top range is last — and it is the open one.
    expect(bounds(els).map((b) => [b.min, b.max, b.openEnded])).toEqual([
      [0, 9, false],
      [10, null, true],
    ]);
  });

  it('shows the span a legacy config implies, without it having been stored', () => {
    // Every form saved before `maxScore` existed carries only thresholds. The
    // author must still see a range, or the field is blank on forms that work.
    const els = render({ config: cfg([outcome('a', 0), outcome('b', 3), outcome('c', 6)]) });
    expect(bounds(els).map((b) => [b.min, b.max])).toEqual([
      [0, 2],
      [3, 5],
      [6, null],
    ]);
  });

  it('writes a bound that fits', () => {
    const onOutcomesChange = vi.fn();
    const els = render({
      config: cfg([outcome('a', 0, { maxScore: 2 }), outcome('b', 3)]),
      onOutcomesChange,
    });
    expect(commit(els, 0, { maxScore: 1 })).toBeNull();
    expect(onOutcomesChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'a', maxScore: 1 }),
      expect.objectContaining({ id: 'b' }),
    ]);
  });

  it('REFUSES a bound that would make two ranges claim the same score', () => {
    const onOutcomesChange = vi.fn();
    const els = render({
      config: cfg([outcome('a', 0, { maxScore: 2 }), outcome('b', 3, { label: 'Book a call' })]),
      onOutcomesChange,
    });
    // Stretching the first range to 5 reaches into the second, which starts at 3.
    // The refusal names the range it would have hit, not the one being edited.
    const error = commit(els, 0, { maxScore: 5 });
    expect(error).toContain('Book a call');
    expect(error).toContain('3+');
    // The refusal is the whole point: nothing is written, so the field reverts.
    expect(onOutcomesChange).not.toHaveBeenCalled();
  });

  it('REFUSES a range that would end below where it starts', () => {
    const onOutcomesChange = vi.fn();
    const els = render({ config: cfg([outcome('a', 0, { maxScore: 5 })]), onOutcomesChange });
    expect(commit(els, 0, { maxScore: -4 })).toBe(bm.results.rangeInverted);
    expect(onOutcomesChange).not.toHaveBeenCalled();
  });

  it('accepts a cleared upper bound, handing the range back to the next threshold', () => {
    const onOutcomesChange = vi.fn();
    const els = render({
      config: cfg([outcome('a', 0, { maxScore: 1 }), outcome('b', 3)]),
      onOutcomesChange,
    });
    expect(commit(els, 0, { maxScore: undefined })).toBeNull();
    expect(onOutcomesChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'a', maxScore: undefined }),
      expect.objectContaining({ id: 'b' }),
    ]);
  });

  it('marks a row whose span already collides, for configs written elsewhere', () => {
    // The veto only guards this screen. The API can still store an overlap, and
    // a row that can never win has to say so rather than look ordinary.
    const els = render({ config: cfg([outcome('a', 0, { maxScore: 9 }), outcome('b', 5, { maxScore: 9 })]) });
    const rows = allByTestId(els, 'outcome-row');
    expect((rows[0]!.props as AnyProps)['data-overlap']).toBeUndefined();
    expect((rows[1]!.props as AnyProps)['data-overlap']).toBe(true);
  });

  it('says which scores no range covers, and stays quiet when they all do', () => {
    const withGap = render({ config: cfg([outcome('a', 0, { maxScore: 2 }), outcome('b', 8)]) });
    const note = byTestId(withGap, 'outcome-gap-note')!;
    expect(note).toBeDefined();
    expect(String((note.props as AnyProps).children)).toContain('3–7');

    const tiled = render({ config: cfg([outcome('a', 0, { maxScore: 2 }), outcome('b', 3)]) });
    expect(byTestId(tiled, 'outcome-gap-note')).toBeUndefined();
  });

  it('draws the gap on the score bar too, so the picture matches the note', () => {
    // ScoreBar is a child element of the dialog's tree, so it has to be invoked
    // on its own to see inside it — it holds no state, which is why it can be.
    const withGap = collect(ScoreBar({ outcomes: [outcome('a', 0, { maxScore: 2 }), outcome('b', 8)], top: 10 }));
    expect(allByTestId(withGap, 'outcomes-score-gap')).toHaveLength(1);
    const tiled = collect(ScoreBar({ outcomes: [outcome('a', 0, { maxScore: 2 }), outcome('b', 3)], top: 10 }));
    expect(allByTestId(tiled, 'outcomes-score-gap')).toHaveLength(0);
  });

  it('never lets a long label widen or spill out of its segment', () => {
    // A 3-point range beside a 90-point one: the segment is a sliver whatever
    // the label says. The label yields (initials + full text in `title`),
    // the layout does not.
    const long = 'Excelente fit, agendemos una llamada esta misma semana';
    const els = collect(
      ScoreBar({ outcomes: [outcome('a', 0, { maxScore: 2, label: long }), outcome('b', 3, { label: 'P1' })], top: 100 }),
    );
    const segs = allByTestId(els, 'outcomes-score-segment');
    expect(segs).toHaveLength(2);
    const [narrow, wide] = segs.map((el) => el.props as AnyProps);
    expect(narrow!.title).toBe(long);
    expect(String(narrow!.className)).toContain('min-w-0');
    const narrowText = collect(narrow!.children as ReactNode).find((el) => el.type === 'span')!;
    expect(String((narrowText.props as AnyProps).className)).toContain('truncate');
    expect((narrowText.props as AnyProps).children).toBe('EF');
    // The roomy one keeps its words (and still truncates rather than wrapping).
    const wideText = collect(wide!.children as ReactNode).find((el) => el.type === 'span')!;
    expect((wideText.props as AnyProps).children).toBe('P1');
    expect(String((wideText.props as AnyProps).className)).toContain('truncate');
  });

  it('segmentLabel: initials only below the share floor, short codes always whole', () => {
    expect(segmentLabel('Muy buen fit', 0.5)).toBe('Muy buen fit');
    expect(segmentLabel('Muy buen fit', 0.05)).toBe('MB');
    expect(segmentLabel('Excelente', 0.05)).toBe('EX');
    expect(segmentLabel('P3', 0.01)).toBe('P3');
    expect(segmentLabel('#4', 0.01)).toBe('#4');
  });

  it('closes the range below when a new one takes over the open top', () => {
    const onOutcomesChange = vi.fn();
    const els = render({ config: cfg([outcome('a', 0, { maxScore: 2 }), outcome('b', 3)]), onOutcomesChange });
    const add = byTestId(els, 'results-add-range')!;
    ((add.props as AnyProps).onClick as () => void)();
    const next = onOutcomesChange.mock.calls[0]![0] as FormOutcome[];
    // 'b' was open; it now ends where the new range begins, so the two do not
    // overlap the instant the row appears.
    expect(next[1]).toEqual(expect.objectContaining({ id: 'b', maxScore: 3 }));
    expect(next[2]!.minScore).toBe(4);
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
      'outcome-redirect-delay',
      'outcome-override',
    ]) {
      expect(byTestId(els, id), id).toBeDefined();
    }
    // `outcome-minscore` / `outcome-maxscore` sit on the inputs INSIDE
    // `RangeBounds`, which holds a typing draft in state and so cannot be
    // invoked here — assert the component is mounted and wired with the span it
    // is meant to show; Playwright drives the attributes themselves.
    expect(bounds(els)[0]).toMatchObject({ min: 0, max: null, openEnded: true });
    // `outcome-message` is a `testId` PROP on TokenTextarea, not a DOM attr.
    expect(els.some((el) => (el.props as AnyProps).testId === 'outcome-message')).toBe(true);
    // `outcome-redirect` sits on the input INSIDE RedirectField, which holds a
    // typing draft in state and so cannot be invoked here — assert the field is
    // mounted and wired; Playwright drives the attribute itself.
    // `onCommit` alone no longer identifies it — `RangeBounds` carries one too.
    const redirect = els.find(
      (el) =>
        typeof el.type === 'function' &&
        'onCommit' in (el.props as object) &&
        !('openEnded' in (el.props as object)),
    )!;
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
