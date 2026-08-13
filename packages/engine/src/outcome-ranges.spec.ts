/**
 * Outcome spans — explicit `maxScore`, and the implicit ranges that predate it.
 *
 * Ranges used to be implicit: an outcome stored where it STARTED and ended
 * wherever the next one began. `maxScore` makes the span something the author
 * types instead of something they infer. The load-bearing property is that
 * adding it changed nothing for a config that does not carry it — every stored
 * form has to keep resolving to the outcome it resolved to yesterday.
 */
import { describe, expect, it } from 'vitest';
import type { FormConfig, FormOutcome } from './form-logic';
import { outcomeGaps, outcomeRanges, overlappingOutcomes, resolveOutcome } from './form-logic';

const o = (id: string, minScore: number, maxScore?: number): FormOutcome =>
  maxScore === undefined ? { id, label: id, minScore } : { id, label: id, minScore, maxScore };

/** A config whose only interesting part is its outcomes. */
const cfg = (outcomes: FormOutcome[]): FormConfig =>
  ({ version: 1, steps: [], scoring: { enabled: true }, outcomes }) as unknown as FormConfig;

describe('outcomeRanges', () => {
  it('reads the span straight off an explicit maxScore', () => {
    expect(outcomeRanges([o('a', -8, -1), o('b', 0, 2), o('c', 3)])).toEqual([
      { min: -8, max: -1 },
      { min: 0, max: 2 },
      { min: 3, max: null },
    ]);
  });

  it('derives the span from the next threshold when maxScore is absent', () => {
    // The shape every form stored before `maxScore` existed.
    expect(outcomeRanges([o('a', 0), o('b', 3), o('c', 6)])).toEqual([
      { min: 0, max: 2 },
      { min: 3, max: 5 },
      { min: 6, max: null },
    ]);
  });

  it('derives from the SMALLEST higher threshold, not the next array slot', () => {
    // Unsorted input: a helper that looked at `outcomes[i + 1]` would give
    // range `a` a max of 9 here, and every screen drawing it would be wrong.
    expect(outcomeRanges([o('a', 0), o('c', 10), o('b', 3)])).toEqual([
      { min: 0, max: 2 },
      { min: 10, max: null },
      { min: 3, max: 9 },
    ]);
  });

  it('mixes explicit and derived bounds on the same list', () => {
    expect(outcomeRanges([o('a', 0, 1), o('b', 3), o('c', 6)])).toEqual([
      { min: 0, max: 1 },
      { min: 3, max: 5 },
      { min: 6, max: null },
    ]);
  });

  it('treats a missing minScore as 0', () => {
    expect(outcomeRanges([{ id: 'a', label: 'a' }])).toEqual([{ min: 0, max: null }]);
  });
});

describe('overlappingOutcomes', () => {
  it('finds nothing on ranges that merely touch', () => {
    expect(overlappingOutcomes([o('a', 0, 2), o('b', 3, 5), o('c', 6)])).toEqual([]);
  });

  it('reports the LATER of two ranges that share a score', () => {
    expect(overlappingOutcomes([o('a', 0, 5), o('b', 4, 8)])).toEqual([1]);
  });

  it('reports a range swallowed whole by an earlier one', () => {
    expect(overlappingOutcomes([o('a', 0, 20), o('b', 5, 6)])).toEqual([1]);
  });

  it('catches a range typed past the start of the OPEN-ENDED last one', () => {
    // The realistic collision: the last range is left open at 6, and an earlier
    // one is given an upper bound of 8. Only the range with the highest start
    // is genuinely open — every other absent bound still closes against the next
    // threshold, which is why `[o('a', 0), o('b', 40, 50)]` does NOT collide.
    expect(overlappingOutcomes([o('a', 0, 8), o('b', 6)])).toEqual([1]);
  });

  it('reports duplicated thresholds, which is what the old badge called unreachable', () => {
    expect(overlappingOutcomes([o('a', 0, 5), o('b', 0, 5)])).toEqual([1]);
  });

  it('ignores an inverted span rather than calling it an overlap', () => {
    // min > max intersects nothing. It is wrong for its own reasons, and the
    // editor refuses to commit it in the first place.
    expect(overlappingOutcomes([o('a', 0, 5), o('b', 9, 2)])).toEqual([]);
  });

  it('finds nothing in a config with no explicit bounds at all', () => {
    // Derived ranges tile by construction — no already-stored form can start
    // reporting an overlap because this field was added.
    expect(overlappingOutcomes([o('a', -8), o('b', 0), o('c', 3), o('d', 6)])).toEqual([]);
  });
});

describe('outcomeGaps', () => {
  it('finds nothing when the ranges tile', () => {
    expect(outcomeGaps([o('a', 0, 2), o('b', 3, 5), o('c', 6)])).toEqual([]);
  });

  it('names the scores that fall between two ranges', () => {
    expect(outcomeGaps([o('a', -8, -1), o('b', 3, 5)])).toEqual([{ min: 0, max: 2 }]);
  });

  it('finds a gap regardless of the order the ranges are stored in', () => {
    expect(outcomeGaps([o('b', 3, 5), o('a', -8, -1)])).toEqual([{ min: 0, max: 2 }]);
  });

  it('reports every gap, not just the first', () => {
    expect(outcomeGaps([o('a', 0, 1), o('b', 5, 6), o('c', 10, 11)])).toEqual([
      { min: 2, max: 4 },
      { min: 7, max: 9 },
    ]);
  });

  it('invents no floor below the lowest range', () => {
    // Scores go negative. "Nothing covers -50" is not a gap the author left.
    expect(outcomeGaps([o('a', 10, 20), o('b', 21)])).toEqual([]);
  });

  it('stops at an open-ended range instead of counting past it', () => {
    expect(outcomeGaps([o('a', 0, 2), o('b', 3), o('c', 40, 41)])).toEqual([]);
  });
});

describe('resolveOutcome with an upper bound', () => {
  it('keeps a score inside its own range', () => {
    const config = cfg([o('low', 0, 2), o('mid', 3, 5), o('high', 6)]);
    expect(resolveOutcome(config, 1)?.id).toBe('low');
    expect(resolveOutcome(config, 4)?.id).toBe('mid');
    expect(resolveOutcome(config, 99)?.id).toBe('high');
  });

  it('honours the bound at both edges', () => {
    const config = cfg([o('low', 0, 2), o('high', 3)]);
    expect(resolveOutcome(config, 2)?.id).toBe('low');
    expect(resolveOutcome(config, 3)?.id).toBe('high');
  });

  it('returns null for a score in a gap, so the form ending takes over', () => {
    // The whole reason a gap is allowed but announced.
    expect(resolveOutcome(cfg([o('a', 0, 2), o('b', 10, 12)]), 5)).toBeNull();
  });

  it('returns null above a fully closed set of ranges', () => {
    expect(resolveOutcome(cfg([o('a', 0, 2)]), 7)).toBeNull();
  });

  it('resolves a config with NO bounds exactly as it always did', () => {
    // The back-compat guarantee, stated as a test: highest cleared threshold.
    const config = cfg([o('a', 0), o('b', 3), o('c', 6)]);
    expect(resolveOutcome(config, 0)?.id).toBe('a');
    expect(resolveOutcome(config, 5)?.id).toBe('b');
    expect(resolveOutcome(config, 1000)?.id).toBe('c');
  });

  it('does not let a derived span steal from an outcome sharing a threshold', () => {
    // Two outcomes at minScore 0: the stored bound decides, and neither has
    // one, so the pre-existing "first declared wins the tie" still holds.
    const config = cfg([o('first', 0), o('second', 0)]);
    expect(resolveOutcome(config, 4)?.id).toBe('first');
  });
});
