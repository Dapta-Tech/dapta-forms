import { describe, it, expect } from 'vitest';
import type { FormStep } from '@quill/engine';
import { anchorRevealsLast } from './logic-util';

const q = (key: string): FormStep => ({ key, type: 'text' });
const reveal = (key: string): FormStep => ({ key, type: 'reveal' });

describe('anchorRevealsLast (vertical layout — reveals always at the end)', () => {
  it('moves a mid-list reveal to the end, preserving question order', () => {
    const steps = [q('a'), reveal('r1'), q('b'), q('c')];
    expect(anchorRevealsLast(steps).map((s) => s.key)).toEqual(['a', 'b', 'c', 'r1']);
  });

  it('groups multiple reveals at the end in their original relative order', () => {
    const steps = [reveal('r1'), q('a'), reveal('r2'), q('b')];
    expect(anchorRevealsLast(steps).map((s) => s.key)).toEqual(['a', 'b', 'r1', 'r2']);
  });

  it('returns the SAME array when already anchored (identity = unchanged)', () => {
    const anchored = [q('a'), q('b'), reveal('r1')];
    expect(anchorRevealsLast(anchored)).toBe(anchored);
  });

  it('returns the SAME array when there are no reveals', () => {
    const steps = [q('a'), q('b')];
    expect(anchorRevealsLast(steps)).toBe(steps);
  });
});

describe('describeCondition — the reserved score source', () => {
  const labels = {
    fallbackQuestion: (i: number) => `Question ${i + 1}`,
    opIn: 'is any of',
    opEq: 'equals',
    opGt: 'is greater than',
    opLt: 'is less than',
    opBetween: 'is between',
    and: 'and',
    blank: '(not set)',
    score: 'Score so far',
  };
  const steps = [q('role'), q('company')];

  it('names the score source and never marks it dangling', async () => {
    const { describeCondition } = await import('./logic-util');
    const d = describeCondition({ field: '@score', op: 'gt', value: 5 }, steps, labels);
    expect(d.field).toBe('Score so far');
    expect(d.operator).toBe('is greater than');
    expect(d.operand).toBe('5');
    expect(d.dangling).toBe(false);
  });

  it('a missing STEP field still dangles (score handling must not mask it)', async () => {
    const { describeCondition } = await import('./logic-util');
    const d = describeCondition({ field: 'ghost', values: ['x'] }, steps, labels);
    expect(d.field).toBe('ghost');
    expect(d.dangling).toBe(true);
  });
});
