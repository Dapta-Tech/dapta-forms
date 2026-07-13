import { describe, it, expect } from 'vitest';
import {
  visibleSteps,
  validateAnswer,
  computeScore,
  resolveOutcome,
  type FormConfig,
  type FormStep,
} from './form-logic';

const step = (partial: Partial<FormStep> & Pick<FormStep, 'key' | 'type'>): FormStep => partial;

const config: FormConfig = {
  version: 1,
  steps: [
    step({
      key: 'role',
      type: 'dropdown',
      flowGroup: 'qualification',
      required: true,
      options: [
        { label: 'Founder', value: 'founder', points: 10 },
        { label: 'Student', value: 'student', points: 0 },
      ],
    }),
    step({
      key: 'budget',
      type: 'slider',
      flowGroup: 'qualification',
      min: 0,
      max: 100,
      sliderScoring: [
        { min: 0, max: 49, points: 0 },
        { min: 50, max: 100, points: 5 },
      ],
    }),
    // Only shown to founders.
    step({
      key: 'company',
      type: 'text',
      flowGroup: 'qualification',
      showWhen: { field: 'role', values: ['founder'] },
      required: true,
    }),
    step({ key: 'email', type: 'email', flowGroup: 'lead_capture', required: true }),
  ],
  outcomes: [
    { id: 'low', label: 'Low', minScore: 0 },
    { id: 'high', label: 'High', minScore: 10 },
  ],
};

describe('visibleSteps', () => {
  it('hides a showWhen step until its condition holds', () => {
    const keys = visibleSteps(config, {}).map((s) => s.key);
    expect(keys).toEqual(['role', 'budget', 'email']);
  });

  it('reveals the branch step when the condition is met', () => {
    const keys = visibleSteps(config, { role: 'founder' }).map((s) => s.key);
    expect(keys).toEqual(['role', 'budget', 'company', 'email']);
  });

  it('respects hideWhen', () => {
    const cfg: FormConfig = {
      version: 1,
      steps: [step({ key: 'a', type: 'text', hideWhen: { field: 'skip', values: ['yes'] } })],
    };
    expect(visibleSteps(cfg, { skip: 'yes' })).toHaveLength(0);
    expect(visibleSteps(cfg, { skip: 'no' })).toHaveLength(1);
  });
});

describe('validateAnswer', () => {
  it('enforces required', () => {
    expect(validateAnswer(step({ key: 'x', type: 'text', required: true }), '')).toEqual({
      ok: false,
      error: 'This field is required.',
    });
  });

  it('accepts an empty optional field', () => {
    expect(validateAnswer(step({ key: 'x', type: 'text' }), '')).toEqual({ ok: true });
  });

  it('validates email format and corporate-only', () => {
    const s = step({ key: 'e', type: 'email', corporateEmailOnly: true, required: true });
    expect(validateAnswer(s, 'nope').ok).toBe(false);
    expect(validateAnswer(s, 'a@gmail.com').ok).toBe(false);
    expect(validateAnswer(s, 'a@acme.io').ok).toBe(true);
  });

  it('validates phone digit count', () => {
    const s = step({ key: 'p', type: 'phone', phoneMinDigits: 7, required: true });
    expect(validateAnswer(s, '12').ok).toBe(false);
    expect(validateAnswer(s, '+57 300 123 4567').ok).toBe(true);
  });

  it('rejects an out-of-range slider and unknown option', () => {
    expect(validateAnswer(step({ key: 's', type: 'slider', min: 0, max: 10 }), 99).ok).toBe(false);
    const choice = step({ key: 'c', type: 'dropdown', options: [{ label: 'A', value: 'a' }] });
    expect(validateAnswer(choice, 'zzz').ok).toBe(false);
    expect(validateAnswer(choice, 'a').ok).toBe(true);
  });
});

describe('computeScore', () => {
  it('sums option + slider points over qualification steps only', () => {
    const score = computeScore(config, { role: 'founder', budget: 80, company: 'Acme', email: 'a@acme.io' });
    expect(score).toBe(15); // 10 (founder) + 5 (budget >= 50)
  });

  it('excludes points from hidden branches', () => {
    // Student never sees `company`; only role(0) + budget(0).
    expect(computeScore(config, { role: 'student', budget: 10 })).toBe(0);
  });

  it('returns 0 when scoring is disabled', () => {
    expect(computeScore({ ...config, scoring: { enabled: false } }, { role: 'founder', budget: 80 })).toBe(0);
  });
});

describe('resolveOutcome', () => {
  it('picks the highest bucket the score clears', () => {
    expect(resolveOutcome(config, 15)?.id).toBe('high');
    expect(resolveOutcome(config, 3)?.id).toBe('low');
  });
});
