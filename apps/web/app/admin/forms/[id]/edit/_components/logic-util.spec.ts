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

describe('the goto vocabulary — a dead rule is ignored, never stripped', () => {
  // The predicate is "does this step record an answer?", not "is this a `*` on
  // an inputless type": `resolveGoto` matches EVERY rule against the step's own
  // answer, so on a message/reveal a plain value rule is just as dead as a
  // catch-all. Proven against the engine: a message carrying
  // `{values:['*'],target:'c'}` still walks note → b → c.
  const message = (goto: FormStep['goto']): FormStep => ({ key: 'note', type: 'message', goto });

  it('a message reports no live rules, whatever the rule says', async () => {
    const { liveGotoRules, liveRuleCount, ruleCount } = await import('./logic-util');
    const catchAll = message([{ values: ['*'], target: 'q2' }]);
    const valueRule = message([{ values: ['a'], target: 'q2' }]);
    for (const step of [catchAll, valueRule]) {
      expect(liveGotoRules(step)).toEqual([]);
      expect(liveRuleCount(step)).toBe(0);
      // …and the raw count still sees it: the rule stays in the config.
      expect(ruleCount(step)).toBe(1);
      expect(step.goto).toHaveLength(1);
    }
  });

  it('a visibility condition still counts on a message', async () => {
    const { liveRuleCount } = await import('./logic-util');
    const step: FormStep = { ...message([{ values: ['*'], target: 'q2' }]), showWhen: { field: 'a', values: ['x'] } };
    expect(liveRuleCount(step)).toBe(1);
  });

  it('an answering step keeps every rule', async () => {
    const { liveGotoRules, liveRuleCount } = await import('./logic-util');
    const step: FormStep = { key: 'pick', type: 'multiple_choice', goto: [{ values: ['a'], target: 'q3' }, { values: ['*'], target: 'q5' }] };
    expect(liveGotoRules(step)).toHaveLength(2);
    expect(liveRuleCount(step)).toBe(2);
  });

  it('buildGoto always writes the catch-all LAST (first match wins in the engine)', async () => {
    const { buildGoto, splitGoto, alwaysValueOf, GOTO_END, GOTO_NEXT } = await import('./logic-util');
    const rules = buildGoto([{ values: ['a'], target: 'q3' }], 'q5');
    expect(rules).toEqual([{ values: ['a'], target: 'q3' }, { values: ['*'], target: 'q5' }]);
    expect(buildGoto([{ values: ['a'], target: 'q3' }], GOTO_END)).toEqual([
      { values: ['a'], target: 'q3' },
      { values: ['*'], target: null },
    ]);
    // Round-trip: split → read → rebuild is the identity.
    const step: FormStep = { key: 'pick', type: 'multiple_choice', goto: rules };
    const { valueRules, catchAll } = splitGoto(step);
    expect(buildGoto(valueRules, alwaysValueOf(catchAll))).toEqual(rules);
    // No rules and no catch-all clears the field rather than storing [].
    expect(buildGoto([], GOTO_NEXT)).toBeUndefined();
  });
});
