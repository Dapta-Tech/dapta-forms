import { describe, it, expect } from 'vitest';
import {
  visibleSteps,
  validateAnswer,
  validateAnswerCode,
  phoneSubscriberDigits,
  computeScore,
  resolveOutcome,
  isPersonalEmail,
  interpolate,
  resolveStepDisplay,
  runtimeSteps,
  isMultiSelect,
  partialSubmitKey,
  revealAfterKey,
  nameFields,
  isSafeHttpUrl,
  isSafeImageUrl,
  operatorsForFieldType,
  conditionsContradict,
  type FormConfig,
  type FormStep,
  type StepCondition,
  type Answers,
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

describe('operatorsForFieldType (V4-07 — operators by field type)', () => {
  it('offers the numeric comparison set for slider', () => {
    expect(operatorsForFieldType('slider')).toEqual(['eq', 'gt', 'lt', 'between']);
  });

  it('keeps "matches any of" (in) for choice / text / email', () => {
    for (const t of ['multiple_choice', 'dropdown', 'text', 'email', 'name', 'phone'] as const) {
      expect(operatorsForFieldType(t)).toEqual(['in']);
    }
  });
});

describe('conditionHolds operators (V4-07 — via visibleSteps)', () => {
  /** A slider `n` followed by a text step gated by `cond` (show or hide). */
  const gated = (cond: StepCondition, which: 'showWhen' | 'hideWhen' = 'showWhen'): FormConfig => ({
    version: 1,
    steps: [
      step({ key: 'n', type: 'slider', min: 0, max: 100 }),
      step(which === 'showWhen' ? { key: 'g', type: 'text', showWhen: cond } : { key: 'g', type: 'text', hideWhen: cond }),
    ],
  });
  const showsG = (cfg: FormConfig, answers: Answers): boolean =>
    visibleSteps(cfg, answers).some((s) => s.key === 'g');

  it('eq: visible only on an exact numeric match (numeric strings parse)', () => {
    const cfg = gated({ field: 'n', op: 'eq', value: 5 });
    expect(showsG(cfg, { n: 5 })).toBe(true);
    expect(showsG(cfg, { n: 6 })).toBe(false);
    expect(showsG(cfg, { n: '5' })).toBe(true);
  });

  it('gt / lt compare the numeric answer', () => {
    expect(showsG(gated({ field: 'n', op: 'gt', value: 50 }), { n: 60 })).toBe(true);
    expect(showsG(gated({ field: 'n', op: 'gt', value: 50 }), { n: 40 })).toBe(false);
    expect(showsG(gated({ field: 'n', op: 'gt', value: 50 }), { n: 50 })).toBe(false); // strict
    expect(showsG(gated({ field: 'n', op: 'lt', value: 50 }), { n: 40 })).toBe(true);
    expect(showsG(gated({ field: 'n', op: 'lt', value: 50 }), { n: 60 })).toBe(false);
  });

  it('between is inclusive on both bounds', () => {
    const cfg = gated({ field: 'n', op: 'between', min: 10, max: 20 });
    expect(showsG(cfg, { n: 10 })).toBe(true);
    expect(showsG(cfg, { n: 20 })).toBe(true);
    expect(showsG(cfg, { n: 15 })).toBe(true);
    expect(showsG(cfg, { n: 9 })).toBe(false);
    expect(showsG(cfg, { n: 21 })).toBe(false);
  });

  it('a numeric op never holds for a non-numeric answer or a missing operand', () => {
    expect(showsG(gated({ field: 'n', op: 'gt', value: 50 }), { n: 'abc' })).toBe(false);
    expect(showsG(gated({ field: 'n', op: 'gt', value: 50 }), {})).toBe(false);
    expect(showsG(gated({ field: 'n', op: 'eq' }), { n: 5 })).toBe(false); // no operand
    expect(showsG(gated({ field: 'n', op: 'between', min: 10 }), { n: 15 })).toBe(false); // half range
  });

  it('hideWhen honors numeric ops (hide when gt 50)', () => {
    const cfg = gated({ field: 'n', op: 'gt', value: 50 }, 'hideWhen');
    expect(showsG(cfg, { n: 60 })).toBe(false); // hidden
    expect(showsG(cfg, { n: 40 })).toBe(true); // shown
  });

  it('back-compat: a condition with NO op behaves exactly as `in`', () => {
    const cfg: FormConfig = {
      version: 1,
      steps: [
        step({
          key: 'c',
          type: 'multiple_choice',
          options: [
            { label: 'A', value: 'a' },
            { label: 'B', value: 'b' },
          ],
        }),
        step({ key: 'g', type: 'text', showWhen: { field: 'c', values: ['a'] } }),
      ],
    };
    expect(visibleSteps(cfg, { c: 'a' }).some((s) => s.key === 'g')).toBe(true);
    expect(visibleSteps(cfg, { c: 'b' }).some((s) => s.key === 'g')).toBe(false);
  });
});

describe('conditionsContradict (V4-08 — trivial contradiction guard)', () => {
  it('is false when a side is absent or the fields differ', () => {
    expect(conditionsContradict(null, null)).toBe(false);
    expect(conditionsContradict({ field: 'a', values: ['x'] }, null)).toBe(false);
    expect(conditionsContradict({ field: 'a', values: ['x'] }, { field: 'b', values: ['x'] })).toBe(
      false,
    );
  });

  it('flags identical / subset choice sets on the same field', () => {
    expect(conditionsContradict({ field: 'a', values: ['x'] }, { field: 'a', values: ['x'] })).toBe(
      true,
    );
    // show ⊆ hide
    expect(
      conditionsContradict({ field: 'a', values: ['x'] }, { field: 'a', values: ['x', 'y'] }),
    ).toBe(true);
    // show ⊄ hide
    expect(
      conditionsContradict({ field: 'a', values: ['x', 'y'] }, { field: 'a', values: ['x'] }),
    ).toBe(false);
    // empty show never contradicts
    expect(conditionsContradict({ field: 'a', values: [] }, { field: 'a', values: [] })).toBe(false);
  });

  it('flags overlapping numeric ranges (show interval ⊆ hide interval)', () => {
    expect(
      conditionsContradict({ field: 'n', op: 'eq', value: 5 }, { field: 'n', op: 'eq', value: 5 }),
    ).toBe(true);
    expect(
      conditionsContradict({ field: 'n', op: 'eq', value: 5 }, { field: 'n', op: 'eq', value: 6 }),
    ).toBe(false);
    expect(
      conditionsContradict(
        { field: 'n', op: 'between', min: 50, max: 80 },
        { field: 'n', op: 'between', min: 40, max: 100 },
      ),
    ).toBe(true);
    expect(
      conditionsContradict(
        { field: 'n', op: 'between', min: 40, max: 100 },
        { field: 'n', op: 'between', min: 50, max: 80 },
      ),
    ).toBe(false);
    // x>50 ⊆ x>40 ; x>40 ⊄ x>50
    expect(
      conditionsContradict({ field: 'n', op: 'gt', value: 50 }, { field: 'n', op: 'gt', value: 40 }),
    ).toBe(true);
    expect(
      conditionsContradict({ field: 'n', op: 'gt', value: 40 }, { field: 'n', op: 'gt', value: 50 }),
    ).toBe(false);
    // x<5 ⊆ x<10
    expect(
      conditionsContradict({ field: 'n', op: 'lt', value: 5 }, { field: 'n', op: 'lt', value: 10 }),
    ).toBe(true);
    // 60 ∈ [50,80]
    expect(
      conditionsContradict(
        { field: 'n', op: 'eq', value: 60 },
        { field: 'n', op: 'between', min: 50, max: 80 },
      ),
    ).toBe(true);
  });

  it('is conservative: mixed choice/numeric ops or missing operands never flag', () => {
    expect(
      conditionsContradict({ field: 'n', values: ['5'] }, { field: 'n', op: 'eq', value: 5 }),
    ).toBe(false);
    // show has no operand → not a well-formed interval
    expect(conditionsContradict({ field: 'n', op: 'eq' }, { field: 'n', op: 'eq', value: 5 })).toBe(
      false,
    );
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

  it('counts phone SUBSCRIBER digits, excluding the E.164 dial code', () => {
    const s = step({ key: 'p', type: 'phone', phoneMinDigits: 7, required: true });
    // '+52' + 6 subscriber digits = 6 < 7 → invalid even though the raw string
    // holds 8 digits. The dial code must not pad the length.
    expect(validateAnswer(s, '+52551234').ok).toBe(false);
    // '+52' + 10 subscriber digits (a real MX mobile) → valid.
    expect(validateAnswer(s, '+525512345678').ok).toBe(true);
    // '+1' + 10 subscriber digits (US) → valid.
    expect(validateAnswer(s, '+15106005675').ok).toBe(true);
  });

  it('extracts subscriber digits, excluding the E.164 dial code', () => {
    expect(phoneSubscriberDigits('+525512345678')).toBe('5512345678'); // strip +52
    expect(phoneSubscriberDigits('+15106005675')).toBe('5106005675'); // strip +1
    expect(phoneSubscriberDigits('+57 300 123 4567')).toBe('3001234567'); // ignores spaces
    expect(phoneSubscriberDigits('5551234')).toBe('5551234'); // no '+' → all digits
    expect(phoneSubscriberDigits('')).toBe('');
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

  // Answer-forced overrides (additive `answers` param) --------------------

  // NOTE: the override outcome is declared LAST so plain score bucketing (two
  // outcomes tied at minScore 0 → first declared wins) never picks it — only a
  // matching override rule can. Overrides win regardless of declared position.
  const overrideConfig: FormConfig = {
    version: 1,
    steps: [],
    outcomes: [
      { id: 'low', label: 'Low', minScore: 0 },
      { id: 'high', label: 'High', minScore: 10 },
      {
        id: 'p0',
        label: 'Disqualified',
        minScore: 0,
        overrides: [{ field: 'budget', maxValue: 0 }],
      },
    ],
  };

  it('an override forces its outcome over a higher-scoring bucket', () => {
    // Score 15 would bucket to `high`, but budget <= 0 forces `p0`.
    expect(resolveOutcome(overrideConfig, 15, { budget: 0 })?.id).toBe('p0');
  });

  it('without answers (back-compat) and without a match, bucketing is unchanged', () => {
    expect(resolveOutcome(overrideConfig, 15)?.id).toBe('high'); // legacy 2-arg call
    expect(resolveOutcome(overrideConfig, 15, { budget: 50 })?.id).toBe('high');
    expect(resolveOutcome(overrideConfig, 3, { budget: 50 })?.id).toBe('low');
  });

  it('a missing/empty answer never matches an override', () => {
    expect(resolveOutcome(overrideConfig, 15, {})?.id).toBe('high');
    expect(resolveOutcome(overrideConfig, 15, { budget: null })?.id).toBe('high');
    expect(resolveOutcome(overrideConfig, 15, { budget: '' })?.id).toBe('high');
  });

  it('numeric clauses: maxValue/minValue bound the numeric answer', () => {
    const cfg: FormConfig = {
      version: 1,
      steps: [],
      outcomes: [
        { id: 'rest', label: 'Rest', minScore: 0 },
        { id: 'mid', label: 'Mid', overrides: [{ field: 'n', minValue: 5, maxValue: 10 }] },
      ],
    };
    expect(resolveOutcome(cfg, 0, { n: 5 })?.id).toBe('mid'); // inclusive lower bound
    expect(resolveOutcome(cfg, 0, { n: '7' })?.id).toBe('mid'); // numeric string works
    expect(resolveOutcome(cfg, 0, { n: 10 })?.id).toBe('mid'); // inclusive upper bound
    expect(resolveOutcome(cfg, 0, { n: 11 })?.id).toBe('rest'); // above max
    expect(resolveOutcome(cfg, 0, { n: 4 })?.id).toBe('rest'); // below min
  });

  it('a non-numeric answer fails numeric clauses', () => {
    expect(resolveOutcome(overrideConfig, 15, { budget: 'none' })?.id).toBe('high');
    expect(resolveOutcome(overrideConfig, 15, { budget: ['a'] })?.id).toBe('high');
  });

  it('values clause: matches on string/array answer intersection', () => {
    const cfg: FormConfig = {
      version: 1,
      steps: [],
      outcomes: [
        { id: 'rest', label: 'Rest', minScore: 0 },
        { id: 'p0', label: 'DQ', overrides: [{ field: 'role', values: ['student'] }] },
      ],
    };
    expect(resolveOutcome(cfg, 20, { role: 'student' })?.id).toBe('p0');
    expect(resolveOutcome(cfg, 20, { role: ['founder', 'student'] })?.id).toBe('p0');
    expect(resolveOutcome(cfg, 20, { role: 'founder' })?.id).toBe('rest');
  });

  it('ALL specified clauses must hold on one rule', () => {
    const cfg: FormConfig = {
      version: 1,
      steps: [],
      outcomes: [
        { id: 'rest', label: 'Rest', minScore: 0 },
        {
          id: 'p0',
          label: 'DQ',
          overrides: [{ field: 'n', values: ['0'], maxValue: 0 }],
        },
      ],
    };
    expect(resolveOutcome(cfg, 20, { n: 0 })?.id).toBe('p0'); // '0' intersects AND 0 <= 0
    expect(resolveOutcome(cfg, 20, { n: '-1' })?.id).toBe('rest'); // numeric ok, values miss
  });

  it('outcomes are scanned in declared order — the first matching override wins', () => {
    const cfg: FormConfig = {
      version: 1,
      steps: [],
      outcomes: [
        { id: 'first', label: 'First', minScore: 0, overrides: [{ field: 'n', maxValue: 0 }] },
        { id: 'second', label: 'Second', minScore: 0, overrides: [{ field: 'n', maxValue: 5 }] },
      ],
    };
    expect(resolveOutcome(cfg, 99, { n: 0 })?.id).toBe('first'); // both match; first declared wins
    expect(resolveOutcome(cfg, 99, { n: 3 })?.id).toBe('second'); // only the second matches
  });
});

describe('isPersonalEmail', () => {
  it('flags free-mail domains and passes corporate ones', () => {
    expect(isPersonalEmail('a@gmail.com')).toBe(true);
    expect(isPersonalEmail('a@hotmail.co.uk')).toBe(true);
    expect(isPersonalEmail('a@acme.io')).toBe(false);
    expect(isPersonalEmail(null)).toBe(false);
    expect(isPersonalEmail(123)).toBe(false);
  });
});

describe('authored step order is authoritative (WYSIWYG)', () => {
  it('never reorders by flowGroup — lead_capture steps render exactly where authored', () => {
    const cfg: FormConfig = {
      version: 1,
      steps: [
        step({ key: 'email', type: 'email', flowGroup: 'lead_capture' }),
        step({ key: 'q1', type: 'text', flowGroup: 'qualification' }),
        step({ key: 'phone', type: 'phone', flowGroup: 'lead_capture' }),
        step({ key: 'q2', type: 'text' }), // no group
      ],
    };
    expect(runtimeSteps(cfg, {}).map((s) => s.key)).toEqual(['email', 'q1', 'phone', 'q2']);
  });

  it('regression: a form authored [name, text, select] walks [name, text, select]', () => {
    // The exact P0 shape: a name step authored FIRST (auto-tagged lead_capture by
    // the editor) must be the FIRST public question, not pushed to the end.
    const cfg: FormConfig = {
      version: 1,
      steps: [
        step({
          key: 'name',
          type: 'name',
          flowGroup: 'lead_capture',
          fields: ['firstname', 'lastname'],
        }),
        step({ key: 'details', type: 'text', flowGroup: 'qualification' }),
        step({
          key: 'industry',
          type: 'multiple_choice',
          flowGroup: 'qualification',
          options: [{ label: 'SaaS', value: 'saas' }],
        }),
      ],
    };
    expect(runtimeSteps(cfg, {}).map((s) => s.key)).toEqual(['name', 'details', 'industry']);
  });
});

describe('personal-email branch (showForPersonalEmailOnly)', () => {
  const branchCfg: FormConfig = {
    version: 1,
    steps: [
      step({ key: 'email', type: 'email', flowGroup: 'lead_capture' }),
      step({ key: 'website', type: 'text', flowGroup: 'lead_capture', showForPersonalEmailOnly: true }),
      step({ key: 'phone', type: 'phone', flowGroup: 'lead_capture' }),
    ],
  };
  it('hides the branch for a corporate email and shows it for a personal one', () => {
    expect(visibleSteps(branchCfg, { email: 'a@acme.io' }).map((s) => s.key)).toEqual(['email', 'phone']);
    expect(visibleSteps(branchCfg, { email: 'a@gmail.com' }).map((s) => s.key)).toEqual([
      'email',
      'website',
      'phone',
    ]);
  });
});

describe('interpolate + resolveStepDisplay', () => {
  it('substitutes [key] tokens, cleaning up orphaned punctuation for empty ones', () => {
    expect(interpolate('Hi [firstname]!', { firstname: 'Ada' })).toBe('Hi Ada!');
    // Empty token drops the space in front of it — never render "Hi !".
    expect(interpolate('Hi [firstname]!', {})).toBe('Hi!');
  });

  it('drops a leading empty token with its connector and re-capitalizes', () => {
    expect(interpolate('[firstname], what problem are you solving?', {})).toBe(
      'What problem are you solving?',
    );
    expect(interpolate('[firstname] how are you', {})).toBe('How are you');
  });

  it('collapses an orphaned mid-sentence token without double-spacing', () => {
    expect(interpolate('Hi [firstname], welcome', {})).toBe('Hi, welcome');
  });

  it('sweeps a connector *before* an embedded or trailing empty token', () => {
    // Name-last shape: the comma that joined the token to the clause leaves with it.
    expect(interpolate('What is your role, [firstname]?', {})).toBe('What is your role?');
    // Trailing empty token after a colon: the colon + space are swept, no "Priority:".
    expect(interpolate('Priority: [firstname]', {})).toBe('Priority');
    // A connector *before* the token is swept; one *after* it belongs to the next
    // clause and is kept.
    expect(interpolate('Nice, [firstname]; welcome', {})).toBe('Nice; welcome');
    // The dash branch of the connector class is swept before a trailing token too.
    expect(interpolate('Deadline - [firstname]', {})).toBe('Deadline');
  });

  it('leaves the all-resolved path unchanged (resolved leading token keeps case + comma)', () => {
    expect(interpolate('[firstname], what problem are you solving?', { firstname: 'Ana' })).toBe(
      'Ana, what problem are you solving?',
    );
  });

  it('handles multiple tokens with mixed resolved/unresolved answers', () => {
    // firstname empty (dropped with its preceding space); tools resolved.
    expect(interpolate('Hi [firstname], we see you use [tools]', { tools: 'CRM' })).toBe(
      'Hi, we see you use CRM',
    );
    // leading empty firstname dropped + re-capitalized; lastname resolved.
    expect(interpolate('[firstname] [lastname], hello', { lastname: 'Lee' })).toBe('Lee, hello');
  });

  it('returns a template with no tokens unchanged', () => {
    expect(interpolate('Just plain copy, nothing to fill.', { firstname: 'Ada' })).toBe(
      'Just plain copy, nothing to fill.',
    );
  });
  it('picks the dynamic question variant and slider unit label', () => {
    const s = step({
      key: 'volume',
      type: 'slider',
      question: 'How much?',
      questionField: 'problem',
      questionVariants: { leads: 'How many leads, [firstname]?' },
      sliderLabelVariants: { leads: 'leads / mo' },
    });
    const resolved = resolveStepDisplay(s, { problem: 'leads', firstname: 'Sam' });
    expect(resolved.question).toBe('How many leads, Sam?');
    expect(resolved.sliderUnitLabel).toBe('leads / mo');
  });
});

describe('runtimeSteps', () => {
  it('walks the authored order, applies skip-logic, and resolves display', () => {
    const cfg: FormConfig = {
      version: 1,
      steps: [
        step({ key: 'email', type: 'email', flowGroup: 'lead_capture' }),
        step({
          key: 'problem',
          type: 'dropdown',
          flowGroup: 'qualification',
          question: 'What is the problem?',
          options: [{ label: 'Leads', value: 'leads' }],
        }),
        step({
          key: 'detail',
          type: 'text',
          flowGroup: 'qualification',
          question: 'Tell us more about [problem].',
          showWhen: { field: 'problem', values: ['leads'] },
        }),
      ],
    };
    const walked = runtimeSteps(cfg, { problem: 'leads' });
    // Authored order is preserved verbatim — the lead_capture email step stays
    // first because that is where the author put it.
    expect(walked.map((s) => s.key)).toEqual(['email', 'problem', 'detail']);
    expect(walked[2].question).toBe('Tell us more about leads.');
  });
});

describe('validateAnswerCode', () => {
  it('returns stable codes for each failure', () => {
    expect(validateAnswerCode(step({ key: 'x', type: 'text', required: true }), '')).toEqual({
      ok: false,
      code: 'required',
    });
    expect(validateAnswerCode(step({ key: 'e', type: 'email', required: true }), 'nope').code).toBe('email');
    expect(
      validateAnswerCode(step({ key: 'e', type: 'email', corporateEmailOnly: true }), 'a@gmail.com').code,
    ).toBe('work_email');
    expect(validateAnswerCode(step({ key: 'p', type: 'phone', phoneMinDigits: 8 }), '12').code).toBe('phone');
    // E.164 value: the '+52' dial code is excluded, so 6 subscriber digits < 8.
    expect(validateAnswerCode(step({ key: 'p', type: 'phone', phoneMinDigits: 8 }), '+52551234').code).toBe('phone');
    expect(validateAnswerCode(step({ key: 'p', type: 'phone', phoneMinDigits: 8 }), '+525512345678').ok).toBe(true);
    expect(validateAnswerCode(step({ key: 's', type: 'slider', min: 0, max: 5 }), 9).code).toBe('too_high');
  });
  it('checks both name sub-fields', () => {
    const s = step({ key: 'name', type: 'name', required: true });
    expect(validateAnswerCode(s, undefined, { firstname: 'Ada', lastname: '' }).ok).toBe(false);
    expect(validateAnswerCode(s, undefined, { firstname: 'Ada', lastname: 'Lovelace' }).ok).toBe(true);
    expect(nameFields(s)).toEqual(['firstname', 'lastname']);
  });
});

describe('partialSubmitKey', () => {
  it('resolves the 1-based threshold step key or null', () => {
    expect(partialSubmitKey({ ...config, partialSubmitAfterStep: 4 })).toBe('email');
    expect(partialSubmitKey(config)).toBeNull();
  });
});

describe('revealAfterKey (V4-04 — reveal position resolution)', () => {
  const threeSteps: FormStep[] = [
    step({ key: 'q1', type: 'text' }),
    step({ key: 'q2', type: 'text' }),
    step({ key: 'q3', type: 'text' }),
  ];
  const base: FormConfig = { version: 1, steps: threeSteps, reveal: { enabled: true } };

  it('returns null when the reveal is absent or disabled', () => {
    expect(revealAfterKey({ version: 1, steps: threeSteps })).toBeNull();
    expect(revealAfterKey({ version: 1, steps: threeSteps, reveal: { enabled: false } })).toBeNull();
    // Enabled but no steps → nothing to fire after.
    expect(revealAfterKey({ version: 1, steps: [], reveal: { enabled: true } })).toBeNull();
  });

  it('defaults an enabled reveal to AFTER THE LAST step (never mid-form)', () => {
    expect(revealAfterKey(base)).toBe('q3');
    // `enabled` absent (but reveal present) is treated as on, mirroring the renderer gate.
    expect(revealAfterKey({ version: 1, steps: threeSteps, reveal: {} })).toBe('q3');
  });

  it('honors revealAfterStep (1-based) when set + in range', () => {
    expect(revealAfterKey({ ...base, revealAfterStep: 1 })).toBe('q1');
    expect(revealAfterKey({ ...base, revealAfterStep: 2 })).toBe('q2');
    expect(revealAfterKey({ ...base, revealAfterStep: 3 })).toBe('q3');
  });

  it('falls back to triggersReveal, then default-last, when revealAfterStep is unset/out-of-range', () => {
    const withTrigger: FormConfig = {
      version: 1,
      reveal: { enabled: true },
      steps: [threeSteps[0]!, { ...threeSteps[1]!, triggersReveal: true }, threeSteps[2]!],
    };
    // Back-compat: the legacy per-step boolean still places the reveal in place.
    expect(revealAfterKey(withTrigger)).toBe('q2');
    // revealAfterStep wins over triggersReveal when both are present.
    expect(revealAfterKey({ ...withTrigger, revealAfterStep: 1 })).toBe('q1');
    // Out-of-range revealAfterStep is ignored → falls back to triggersReveal.
    expect(revealAfterKey({ ...withTrigger, revealAfterStep: 99 })).toBe('q2');
    // Out-of-range with no trigger → default-last.
    expect(revealAfterKey({ ...base, revealAfterStep: 0 })).toBe('q3');
  });
});

describe('corporateEmailOnly validation parity (validateAnswer ⇄ validateAnswerCode)', () => {
  // Both validators must agree on the SAME address — validateAnswer previously
  // only checked PERSONAL_EMAIL_DOMAINS while validateAnswerCode used the fuller
  // isPersonalEmail() (domain list + free-mail bases). Now both use isPersonalEmail().
  const s = step({ key: 'e', type: 'email', corporateEmailOnly: true });
  it.each([
    ['user@msn.com', false], // free-mail base "msn"
    ['user@hotmail.co.uk', false], // free-mail base "hotmail" on a cc-TLD
    ['a@gmail.com', false], // exact personal domain
    ['jane@acme.com', true], // corporate → accepted
  ])('agrees on %s (accepted=%s)', (email, expectedOk) => {
    expect(validateAnswer(s, email).ok).toBe(expectedOk);
    expect(validateAnswerCode(s, email).ok).toBe(expectedOk);
  });
});

describe('URL safety guards (XSS)', () => {
  it('isSafeHttpUrl allows only http(s)', () => {
    expect(isSafeHttpUrl('https://example.com/thanks')).toBe(true);
    expect(isSafeHttpUrl('http://localhost:3000/x')).toBe(true);
    expect(isSafeHttpUrl('  HTTPS://Example.com ')).toBe(true);
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeHttpUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeHttpUrl('/relative/path')).toBe(false);
  });
  it('isSafeImageUrl blocks script protocols but allows images/relative', () => {
    expect(isSafeImageUrl('https://cdn.example.com/logo.png')).toBe(true);
    expect(isSafeImageUrl('//cdn.example.com/logo.png')).toBe(true);
    expect(isSafeImageUrl('/assets/logo.svg')).toBe(true);
    expect(isSafeImageUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isSafeImageUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeImageUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeImageUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });
});

describe('goto branching (forward jumps + skip-to-end)', () => {
  const gcfg: FormConfig = {
    version: 1,
    steps: [
      step({
        key: 'budget',
        type: 'dropdown',
        flowGroup: 'qualification',
        options: [
          { label: 'Under $500', value: 'low', points: 0 },
          { label: '$500–2k', value: 'mid', points: 3 },
          { label: '$2,000+', value: 'high', points: 6 },
        ],
        goto: [
          { values: ['low'], target: null }, // skip to end
          { values: ['high'], target: 'urgency' }, // jump ahead
        ],
      }),
      step({ key: 'team', type: 'text', flowGroup: 'qualification' }),
      step({ key: 'urgency', type: 'slider', flowGroup: 'qualification', min: 0, max: 10 }),
      step({ key: 'email', type: 'email', flowGroup: 'lead_capture' }),
    ],
  };

  it('skip-to-end (target null) drops every following step', () => {
    const path = runtimeSteps(gcfg, { budget: 'low' }).map((s) => s.key);
    expect(path).toEqual(['budget']);
  });

  it('jump-to-Q skips the steps in between but keeps the target and the rest', () => {
    const path = runtimeSteps(gcfg, { budget: 'high' }).map((s) => s.key);
    expect(path).toEqual(['budget', 'urgency', 'email']);
    expect(path).not.toContain('team');
  });

  it('no matching rule walks the full ordered path', () => {
    const path = runtimeSteps(gcfg, { budget: 'mid' }).map((s) => s.key);
    expect(path).toEqual(['budget', 'team', 'urgency', 'email']);
  });

  it('scoring ignores steps jumped over by a branch', () => {
    // "high" jumps past `team`; only budget(6) + urgency count toward the score.
    expect(computeScore(gcfg, { budget: 'high', team: 'stale', urgency: 8 })).toBe(6);
  });

  it('a backward/self target is ignored and can never loop', () => {
    const loopy: FormConfig = {
      version: 1,
      steps: [
        step({ key: 'a', type: 'text', flowGroup: 'qualification' }),
        step({
          key: 'b',
          type: 'dropdown',
          flowGroup: 'qualification',
          options: [{ label: 'Back', value: 'back' }],
          goto: [{ values: ['back'], target: 'a' }], // backward — must be ignored
        }),
        step({ key: 'c', type: 'text', flowGroup: 'qualification' }),
      ],
    };
    const path = runtimeSteps(loopy, { b: 'back' }).map((s) => s.key);
    expect(path).toEqual(['a', 'b', 'c']);
  });

  it('a missing target is ignored (flow continues linearly)', () => {
    const cfg: FormConfig = {
      version: 1,
      steps: [
        step({
          key: 'q',
          type: 'dropdown',
          flowGroup: 'qualification',
          options: [{ label: 'X', value: 'x' }],
          goto: [{ values: ['x'], target: 'nope' }],
        }),
        step({ key: 'r', type: 'text', flowGroup: 'qualification' }),
      ],
    };
    expect(runtimeSteps(cfg, { q: 'x' }).map((s) => s.key)).toEqual(['q', 'r']);
  });
});

describe('isMultiSelect + multiple_choice scoring', () => {
  const multi = step({
    key: 'features',
    type: 'multiple_choice',
    selectionMode: 'multiple',
    flowGroup: 'qualification',
    options: [
      { label: 'A', value: 'a', points: 2 },
      { label: 'B', value: 'b', points: 3 },
      { label: 'C', value: 'c', points: 5 },
    ],
  });

  it('flags multiple_choice+multiple as multi-select, single/absent/dropdown as not', () => {
    expect(isMultiSelect(multi)).toBe(true);
    expect(isMultiSelect(step({ key: 'q', type: 'multiple_choice', selectionMode: 'single' }))).toBe(false);
    expect(isMultiSelect(step({ key: 'q', type: 'multiple_choice' }))).toBe(false);
    expect(isMultiSelect(step({ key: 'q', type: 'dropdown', selectionMode: 'multiple' }))).toBe(false);
  });

  it('sums option points across a multi-select answer array', () => {
    const cfg: FormConfig = { version: 1, steps: [multi] };
    expect(computeScore(cfg, { features: ['a', 'c'] })).toBe(7);
    expect(computeScore(cfg, { features: ['a', 'b', 'c'] })).toBe(10);
  });

  it('validates a multi-select answer array against the allowed values', () => {
    expect(validateAnswer(multi, ['a', 'b']).ok).toBe(true);
    expect(validateAnswer(multi, ['a', 'zzz']).ok).toBe(false);
  });
});
