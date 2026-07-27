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
  isInputlessStep,
  partialSubmitKey,
  revealAfterKey,
  nameFields,
  isSafeHttpUrl,
  isSafeImageUrl,
  isImageIcon,
  optionInitials,
  resolveOptionIcon,
  resolveOptionLayout,
  showBanner,
  showClientLogos,
  operatorsForFieldType,
  conditionsContradict,
  conditionsNarrow,
  conditionNeverHolds,
  sliderHasNoTravel,
  overlappingSliderRanges,
  sliderBounds,
  clampSliderValue,
  sliderRangeUnreachable,
  renameStepKey,
  sanitizeStepKey,
  resolveQuestion,
  resolveEnding,
  type FormConfig,
  type FormStep,
  type FormOutcome,
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

  it('skips a hidden step (never walked, never scored — its answer only rides along)', () => {
    const cfg: FormConfig = {
      version: 1,
      steps: [
        step({ key: 'plan', type: 'text' }),
        step({ key: 'source', type: 'text', hidden: true }),
      ],
    };
    // The hidden step is absent from the walk even though it has an answer.
    expect(visibleSteps(cfg, { source: 'ads' }).map((s) => s.key)).toEqual(['plan']);
    expect(runtimeSteps(cfg, { source: 'ads' }).map((s) => s.key)).toEqual(['plan']);
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

  it('interpolates [key] tokens in the helper/description with the same sweep', () => {
    const s = step({ key: 'x', type: 'text', question: 'Q', helper: 'Details for [firstname]' });
    // Resolved: the token substitutes verbatim.
    expect(resolveStepDisplay(s, { firstname: 'Sam' }).helper).toBe('Details for Sam');
    // Trailing empty token sweeps the connector in front of it (no "Details for ").
    expect(resolveStepDisplay(s, {}).helper).toBe('Details for');
    // Embedded empty token keeps a following connector, drops the preceding space.
    const s2 = step({ key: 'y', type: 'text', helper: 'Hi [firstname], read on' });
    expect(resolveStepDisplay(s2, {}).helper).toBe('Hi, read on');
    // A null/undefined helper is left untouched (not coerced to a string).
    expect(resolveStepDisplay(step({ key: 'z', type: 'text' }), {}).helper).toBeUndefined();
    expect(resolveStepDisplay(step({ key: 'z', type: 'text', helper: null }), {}).helper).toBeNull();
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

describe('cover presentation toggles', () => {
  it('showBanner needs banner text before anything else', () => {
    expect(showBanner(undefined, true)).toBe(false);
    expect(showBanner(null, true)).toBe(false);
    expect(showBanner({}, true)).toBe(false);
    expect(showBanner({ bannerText: '' }, true)).toBe(false);
    expect(showBanner({ bannerScope: 'form' }, false)).toBe(false);
  });

  it("showBanner defaults to every screen — a config saved before the toggle can't lose its banner", () => {
    const legacy = { bannerText: 'Limited spots' };
    expect(showBanner(legacy, true)).toBe(true);
    expect(showBanner(legacy, false)).toBe(true);
  });

  it("showBanner scoped to 'cover' hides it on every other screen", () => {
    const scoped = { bannerText: 'Limited spots', bannerScope: 'cover' as const };
    expect(showBanner(scoped, true)).toBe(true);
    expect(showBanner(scoped, false)).toBe(false);
  });

  it("showBanner scoped to 'form' shows it everywhere", () => {
    const scoped = { bannerText: 'Limited spots', bannerScope: 'form' as const };
    expect(showBanner(scoped, true)).toBe(true);
    expect(showBanner(scoped, false)).toBe(true);
  });

  it('showClientLogos hides the marquee only on an explicit false', () => {
    expect(showClientLogos(undefined)).toBe(true);
    expect(showClientLogos(null)).toBe(true);
    expect(showClientLogos({})).toBe(true);
    expect(showClientLogos({ showClientLogos: true })).toBe(true);
    expect(showClientLogos({ showClientLogos: false })).toBe(false);
  });

  it('showClientLogos off keeps the logos in the config — it hides, never deletes', () => {
    const cover = { clientLogos: [{ name: 'Acme' }], showClientLogos: false };
    expect(showClientLogos(cover)).toBe(false);
    expect(cover.clientLogos).toHaveLength(1);
  });
});

describe('choice option presentation', () => {
  it('resolveOptionLayout defaults to a list', () => {
    expect(resolveOptionLayout(undefined)).toBe('list');
    expect(resolveOptionLayout(null)).toBe('list');
    expect(resolveOptionLayout({})).toBe('list');
    expect(resolveOptionLayout({ showIcons: false })).toBe('list');
  });

  it("resolveOptionLayout still honours the deprecated showIcons, so a pre-optionLayout config keeps its grid", () => {
    expect(resolveOptionLayout({ showIcons: true })).toBe('cards');
  });

  it('resolveOptionLayout lets optionLayout win over showIcons', () => {
    expect(resolveOptionLayout({ optionLayout: 'list', showIcons: true })).toBe('list');
    expect(resolveOptionLayout({ optionLayout: 'cards', showIcons: false })).toBe('cards');
  });

  it('isImageIcon spots image references', () => {
    expect(isImageIcon('https://cdn.example.com/logo.png')).toBe(true);
    expect(isImageIcon('http://example.com/a.svg')).toBe(true);
    expect(isImageIcon('//cdn.example.com/logo.png')).toBe(true);
    expect(isImageIcon('/assets/logo.svg')).toBe(true);
    expect(isImageIcon('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isImageIcon('  HTTPS://Example.com/a.png ')).toBe(true);
  });

  it('isImageIcon treats emoji, letters and empties as glyphs', () => {
    expect(isImageIcon('🚀')).toBe(false);
    expect(isImageIcon('😍')).toBe(false);
    expect(isImageIcon('A')).toBe(false);
    expect(isImageIcon('')).toBe(false);
    expect(isImageIcon(null)).toBe(false);
    expect(isImageIcon(undefined)).toBe(false);
  });

  it('isImageIcon does not classify script protocols as images — they never reach an <img src>', () => {
    expect(isImageIcon('javascript:alert(1)')).toBe(false);
    expect(isImageIcon('vbscript:msgbox(1)')).toBe(false);
    expect(isImageIcon('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('an icon that looks like an image must also be a safe one', () => {
    // The renderer requires BOTH; this pins the pair that guards the src.
    const hostile = 'data:text/html,<script>alert(1)</script>';
    expect(isImageIcon(hostile) && isSafeImageUrl(hostile)).toBe(false);
    const ok = 'https://cdn.example.com/logo.png';
    expect(isImageIcon(ok) && isSafeImageUrl(ok)).toBe(true);
  });

  it('optionInitials takes up to two letters from the first two words', () => {
    expect(optionInitials('Hubspot')).toBe('H');
    expect(optionInitials('HubSpot Sales')).toBe('HS');
    expect(optionInitials('one two three')).toBe('OT');
    expect(optionInitials('  spaced   out  ')).toBe('SO');
    expect(optionInitials('')).toBe('');
    expect(optionInitials('   ')).toBe('');
  });
});

describe('resolveOptionIcon — one answer for every surface', () => {
  const IMG = 'https://cdn.example.com/logo.png';

  it('draws an image on cards', () => {
    expect(resolveOptionIcon({ icon: IMG, label: 'Hubspot' }, 'cards')).toEqual({
      kind: 'image',
      src: IMG,
    });
  });

  it('degrades an image to initials on a list — logos are card-only', () => {
    expect(resolveOptionIcon({ icon: IMG, label: 'Hubspot' }, 'list')).toEqual({
      kind: 'glyph',
      text: 'H',
    });
  });

  it('an unsafe image never becomes an <img>, on either layout', () => {
    const hostile = 'data:text/html,<script>alert(1)</script>';
    // `isImageIcon` already rejects this, so it is treated as a glyph verbatim.
    expect(resolveOptionIcon({ icon: hostile, label: 'X' }, 'cards').kind).toBe('glyph');
  });

  it('keeps an emoji or letters as a glyph on both layouts', () => {
    for (const layout of ['cards', 'list'] as const) {
      expect(resolveOptionIcon({ icon: '😍', label: 'Love it' }, layout)).toEqual({
        kind: 'glyph',
        text: '😍',
      });
      expect(resolveOptionIcon({ icon: 'HS', label: 'Hubspot' }, layout)).toEqual({
        kind: 'glyph',
        text: 'HS',
      });
    }
  });

  it('falls back to the label initials when there is no icon', () => {
    expect(resolveOptionIcon({ label: 'Team lead' }, 'cards')).toEqual({
      kind: 'glyph',
      text: 'TL',
    });
    expect(resolveOptionIcon({ icon: null, label: 'Founder' }, 'list')).toEqual({
      kind: 'glyph',
      text: 'F',
    });
    expect(resolveOptionIcon({ icon: '   ', label: 'Founder' }, 'cards')).toEqual({
      kind: 'glyph',
      text: 'F',
    });
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

// ---------------------------------------------------------------------------
// V5 round A — regressions found in the 2026-07-22 verification pass.
// ---------------------------------------------------------------------------

describe('resolveOutcome with scoring disabled (V5-A1)', () => {
  // The exact shape that broke: scoring off, one `minScore: 0` bucket. Every
  // submission scores 0, so the bucket matched everyone and its thank-you copy
  // replaced the form's own ending.
  const scoringOff: FormConfig = {
    version: 1,
    steps: [],
    scoring: { enabled: false },
    outcomes: [{ id: 'r1', label: 'Hot lead', minScore: 0, message: 'Range one copy' }],
  };

  it('resolves to null so the form-level ending is used', () => {
    expect(resolveOutcome(scoringOff, 0)).toBeNull();
    expect(resolveOutcome(scoringOff, 0, { anything: 'x' })).toBeNull();
  });

  it('suppresses answer-forced overrides too', () => {
    const withOverride: FormConfig = {
      ...scoringOff,
      outcomes: [{ id: 'dq', label: 'Disqualified', minScore: 0, overrides: [{ field: 'budget', maxValue: 0 }] }],
    };
    expect(resolveOutcome(withOverride, 0, { budget: 0 })).toBeNull();
  });

  it('leaves the buckets intact — re-enabling scoring restores them', () => {
    const on: FormConfig = { ...scoringOff, scoring: { enabled: true } };
    expect(resolveOutcome(on, 0)?.id).toBe('r1');
  });

  it('an absent or empty scoring block still resolves (only explicit false disables)', () => {
    const { scoring: _omitted, ...noScoring } = scoringOff;
    expect(resolveOutcome(noScoring as FormConfig, 0)?.id).toBe('r1');
    expect(resolveOutcome({ ...scoringOff, scoring: {} }, 0)?.id).toBe('r1');
  });
});

describe('conditionsNarrow (V5-A6 — partial overlap advisory)', () => {
  it('reports the surviving window for the reported case', () => {
    // show 200..500 + hide > 201 leaves only 200..201 visible.
    expect(
      conditionsNarrow(
        { field: 'n', op: 'between', min: 200, max: 500 },
        { field: 'n', op: 'gt', value: 201 },
      ),
    ).toEqual({ lo: 200, hi: 201 });
  });

  it('reports a clipped lower end', () => {
    expect(
      conditionsNarrow(
        { field: 'n', op: 'between', min: 0, max: 100 },
        { field: 'n', op: 'lt', value: 50 },
      ),
    ).toEqual({ lo: 50, hi: 100 });
  });

  it('is silent when the hide rule removes nothing', () => {
    expect(
      conditionsNarrow({ field: 'n', op: 'gt', value: 10 }, { field: 'n', op: 'lt', value: 5 }),
    ).toBeNull();
  });

  it('is silent on a full contradiction — that is the hard error, not this', () => {
    const show: StepCondition = { field: 'n', op: 'between', min: 50, max: 80 };
    const hide: StepCondition = { field: 'n', op: 'between', min: 40, max: 100 };
    expect(conditionsContradict(show, hide)).toBe(true);
    expect(conditionsNarrow(show, hide)).toBeNull();
  });

  it('is silent when the hide rule punches a hole in the middle (two windows)', () => {
    // 0..100 minus 40..60 leaves 0..40 AND 60..100 — not one window, so no claim.
    expect(
      conditionsNarrow(
        { field: 'n', op: 'between', min: 0, max: 100 },
        { field: 'n', op: 'between', min: 40, max: 60 },
      ),
    ).toBeNull();
  });

  it('is silent for different fields, missing sides, and choice rules', () => {
    expect(conditionsNarrow(null, { field: 'n', op: 'gt', value: 1 })).toBeNull();
    expect(
      conditionsNarrow({ field: 'a', op: 'gt', value: 1 }, { field: 'b', op: 'gt', value: 2 }),
    ).toBeNull();
    expect(
      conditionsNarrow({ field: 'a', values: ['x', 'y'] }, { field: 'a', values: ['x'] }),
    ).toBeNull();
  });
});

describe('slider bounds guards (V5-A2 / V5-A3)', () => {
  const s = step({ key: 'n', type: 'slider', min: 0, max: 5 });

  it('normalizes inverted bounds', () => {
    expect(sliderBounds(step({ key: 'n', type: 'slider', min: 90, max: 10 }))).toEqual({ min: 10, max: 90 });
    expect(sliderBounds(step({ key: 'n', type: 'slider' }))).toEqual({ min: 0, max: 100 });
  });

  it('clamps a default that sits outside the bounds', () => {
    // The reported case: min 0, max 5, default 878 rendered a 17560%-wide track.
    expect(clampSliderValue(s, 878)).toBe(5);
    expect(clampSliderValue(s, -20)).toBe(0);
    expect(clampSliderValue(s, 3)).toBe(3);
    expect(clampSliderValue(s, Number.NaN)).toBe(0);
  });

  it('flags a scoring range that lies entirely outside the slider', () => {
    const wide = step({ key: 'n', type: 'slider', min: 0, max: 2000 });
    // The reported case: a 0..2000 slider scoring 5000..6000 can never award.
    expect(sliderRangeUnreachable(wide, { min: 5000, max: 6000, points: 10 })).toBe(true);
    expect(sliderRangeUnreachable(wide, { min: 0, max: 500, points: 10 })).toBe(false);
    // Partial overlap still scores for the reachable part — not flagged.
    expect(sliderRangeUnreachable(wide, { min: 1500, max: 5000, points: 10 })).toBe(false);
  });
});

describe('resolveQuestion with a multi-select source (V5-A7)', () => {
  const multiStep = step({
    key: 'q',
    type: 'short_text',
    question: 'Fallback question',
    questionField: 'tools',
    questionVariants: { 'a,b': 'You picked both', a: 'Just A', '*': 'Something else' },
  });

  it('matches a multi-value row regardless of tick order', () => {
    expect(resolveQuestion(multiStep, { tools: ['a', 'b'] })).toBe('You picked both');
    expect(resolveQuestion(multiStep, { tools: ['b', 'a'] })).toBe('You picked both');
  });

  it('still matches a single value exactly', () => {
    expect(resolveQuestion(multiStep, { tools: ['a'] })).toBe('Just A');
    expect(resolveQuestion(multiStep, { tools: 'a' })).toBe('Just A');
  });

  it('falls back when the set differs — a subset is not a match', () => {
    expect(resolveQuestion(multiStep, { tools: ['a', 'c'] })).toBe('Something else');
    expect(resolveQuestion(multiStep, { tools: ['a', 'b', 'c'] })).toBe('Something else');
  });

  it('never lets the `*` fallback win a set comparison', () => {
    const onlyFallback = step({
      key: 'q',
      type: 'short_text',
      question: 'Plain',
      questionField: 'tools',
      questionVariants: { '*': 'Fallback copy' },
    });
    expect(resolveQuestion(onlyFallback, { tools: ['x', 'y'] })).toBe('Fallback copy');
  });
});

describe('renameStepKey (V5-A10 — editable field key)', () => {
  const cfg: FormConfig = {
    version: 1,
    steps: [
      step({ key: 'budget', type: 'slider', question: 'How much?', min: 0, max: 100 }),
      step({
        key: 'follow',
        type: 'text',
        question: 'You said [budget] — why?',
        helper: 'Context for [budget]',
        showWhen: { field: 'budget', op: 'gt', value: 10 },
        questionField: 'budget',
        questionVariants: { '50': 'Half of [budget]?' },
      }),
      step({ key: 'route', type: 'dropdown', goto: [{ values: ['x'], target: 'budget' }] }),
    ],
    outcomes: [
      { id: 'o1', label: 'Hot', message: 'Budget was [budget]', overrides: [{ field: 'budget', maxValue: 0 }] },
    ],
    reveal: { enabled: true, subtitleTemplate: 'Scoring [budget]…' },
  };

  const renamed = renameStepKey(cfg, 'budget', 'annual_budget');

  it('moves the key itself', () => {
    expect(renamed.steps[0]!.key).toBe('annual_budget');
  });

  it('repoints conditions, goto targets, and variant sources', () => {
    expect(renamed.steps[1]!.showWhen?.field).toBe('annual_budget');
    expect(renamed.steps[1]!.questionField).toBe('annual_budget');
    expect(renamed.steps[2]!.goto?.[0]!.target).toBe('annual_budget');
  });

  it('rewrites [key] tokens everywhere they can appear', () => {
    expect(renamed.steps[1]!.question).toBe('You said [annual_budget] — why?');
    expect(renamed.steps[1]!.helper).toBe('Context for [annual_budget]');
    expect(renamed.steps[1]!.questionVariants?.['50']).toBe('Half of [annual_budget]?');
    expect(renamed.outcomes?.[0]!.message).toBe('Budget was [annual_budget]');
    expect(renamed.reveal?.subtitleTemplate).toBe('Scoring [annual_budget]…');
  });

  it('repoints outcome override rules', () => {
    expect(renamed.outcomes?.[0]!.overrides?.[0]!.field).toBe('annual_budget');
  });

  it('the renamed form still resolves the same branch for the same answer', () => {
    // The rename is behavior-preserving: same answer, same visible steps.
    const before = visibleSteps(cfg, { budget: 50 }).map((s) => s.key);
    const after = visibleSteps(renamed, { annual_budget: 50 }).map((s) => s.key);
    expect(after).toEqual(before.map((k) => (k === 'budget' ? 'annual_budget' : k)));
  });

  it('refuses a no-op, an empty key, or a collision', () => {
    expect(renameStepKey(cfg, 'budget', 'budget')).toBe(cfg);
    expect(renameStepKey(cfg, 'budget', '')).toBe(cfg);
    expect(renameStepKey(cfg, 'budget', 'follow')).toBe(cfg);
    expect(renameStepKey(cfg, 'nope', 'whatever')).toBe(cfg);
  });

  it('leaves tokens alone for a name step — its answers live under its subfields', () => {
    const withName: FormConfig = {
      version: 1,
      steps: [
        step({ key: 'who', type: 'name' }),
        step({ key: 'q', type: 'text', question: 'Hi [firstname], and [who]?' }),
      ],
    };
    const out = renameStepKey(withName, 'who', 'contact');
    expect(out.steps[0]!.key).toBe('contact');
    // `[who]` never resolved to anything, so it is not ours to rewrite.
    expect(out.steps[1]!.question).toBe('Hi [firstname], and [who]?');
  });
});

describe('sanitizeStepKey (V5-A10)', () => {
  it('lowercases and collapses anything outside the token grammar', () => {
    expect(sanitizeStepKey('Annual Budget')).toBe('annual_budget');
    expect(sanitizeStepKey('a-b.c')).toBe('a_b_c');
    expect(sanitizeStepKey('')).toBe('');
  });

  it('caps the length at 64', () => {
    expect(sanitizeStepKey('x'.repeat(100))).toHaveLength(64);
  });
});

describe('per-question scoring (V5-B2)', () => {
  const cfg: FormConfig = {
    version: 1,
    steps: [
      step({
        key: 'a',
        type: 'dropdown',
        flowGroup: 'qualification',
        options: [{ label: 'Yes', value: 'yes', points: 10 }],
      }),
      step({
        key: 'b',
        type: 'dropdown',
        flowGroup: 'qualification',
        options: [{ label: 'Yes', value: 'yes', points: 5 }],
      }),
    ],
  };
  const answers = { a: 'yes', b: 'yes' };

  it('scores every question by default (absent flag = unchanged behavior)', () => {
    expect(computeScore(cfg, answers)).toBe(15);
  });

  it('excludes only the opted-out question, leaving the rest scoring', () => {
    // The whole point: turning one off must NOT turn the others off.
    const oneOff: FormConfig = {
      ...cfg,
      steps: [{ ...cfg.steps[0]!, scoringEnabled: false }, cfg.steps[1]!],
    };
    expect(computeScore(oneOff, answers)).toBe(5);
  });

  it('an explicit true scores exactly like an absent flag', () => {
    const explicit: FormConfig = {
      ...cfg,
      steps: cfg.steps.map((s) => ({ ...s, scoringEnabled: true })),
    };
    expect(computeScore(explicit, answers)).toBe(15);
  });

  it('the form-level switch still wins over any per-question flag', () => {
    const formOff: FormConfig = {
      ...cfg,
      scoring: { enabled: false },
      steps: cfg.steps.map((s) => ({ ...s, scoringEnabled: true })),
    };
    expect(computeScore(formOff, answers)).toBe(0);
  });
});

describe('resolveEnding (V5-B1 — outcome → form → built-in)', () => {
  const outcome = (over: Partial<FormOutcome> = {}): FormOutcome => ({ id: 'o', label: '', ...over });

  it('a legacy config with no ending block resolves to nothing (built-in copy)', () => {
    const out = resolveEnding({ version: 1, steps: [] }, null);
    expect(out).toEqual({ headline: null, body: null, redirectUrl: null, redirectDelayMs: 0 });
  });

  it('the form-level ending applies to everyone when no outcome overrides it', () => {
    const cfg: FormConfig = {
      version: 1,
      steps: [],
      ending: { headline: 'All done', body: 'Thanks [firstname]' },
    };
    expect(resolveEnding(cfg, null).headline).toBe('All done');
    // An outcome that overrides nothing inherits both fields.
    expect(resolveEnding(cfg, outcome()).headline).toBe('All done');
    expect(resolveEnding(cfg, outcome()).body).toBe('Thanks [firstname]');
  });

  it('an outcome overrides the form-level copy field by field', () => {
    const cfg: FormConfig = { version: 1, steps: [], ending: { headline: 'Generic', body: 'Generic body' } };
    const out = resolveEnding(cfg, outcome({ label: 'Hot lead' }));
    expect(out.headline).toBe('Hot lead');
    // Only the heading was overridden — the body still inherits.
    expect(out.body).toBe('Generic body');
  });

  it('an EMPTY outcome field inherits rather than blanking the screen', () => {
    const cfg: FormConfig = { version: 1, steps: [], ending: { headline: 'Generic', body: 'Generic body' } };
    const out = resolveEnding(cfg, outcome({ label: '   ', message: '' }));
    expect(out.headline).toBe('Generic');
    expect(out.body).toBe('Generic body');
  });

  it('redirect: form-level sends everyone, an outcome can still divert', () => {
    const cfg: FormConfig = { version: 1, steps: [], ending: { redirectUrl: 'https://example.com/all' } };
    expect(resolveEnding(cfg, null).redirectUrl).toBe('https://example.com/all');
    expect(resolveEnding(cfg, outcome({ redirectUrl: 'https://example.com/vip' })).redirectUrl).toBe(
      'https://example.com/vip',
    );
  });

  it('a delay only counts when there is somewhere to go', () => {
    const noUrl: FormConfig = { version: 1, steps: [], ending: { redirectDelayMs: 3000 } };
    expect(resolveEnding(noUrl, null).redirectDelayMs).toBe(0);
    const withUrl: FormConfig = {
      version: 1,
      steps: [],
      ending: { redirectUrl: 'https://example.com', redirectDelayMs: 3000 },
    };
    expect(resolveEnding(withUrl, null).redirectDelayMs).toBe(3000);
    // An outcome may shorten or lengthen the hold for its own bucket.
    expect(resolveEnding(withUrl, outcome({ redirectDelayMs: 500 })).redirectDelayMs).toBe(500);
  });

  it('clamps a negative or non-finite delay to an immediate redirect', () => {
    const cfg: FormConfig = {
      version: 1,
      steps: [],
      ending: { redirectUrl: 'https://example.com', redirectDelayMs: -1 },
    };
    expect(resolveEnding(cfg, null).redirectDelayMs).toBe(0);
  });

  it('with scoring off there is no outcome, so the form-level ending is what shows', () => {
    // The V4 complaint end to end: scoring off must not let a range hijack the ending.
    const cfg: FormConfig = {
      version: 1,
      steps: [],
      scoring: { enabled: false },
      ending: { headline: 'Thanks!' },
      outcomes: [{ id: 'r1', label: 'Hot lead', minScore: 0, message: 'Range copy' }],
    };
    const resolved = resolveOutcome(cfg, 0);
    expect(resolved).toBeNull();
    expect(resolveEnding(cfg, resolved).headline).toBe('Thanks!');
  });
});

describe('conditionsNarrow — bounds it must NOT claim (QA V5)', () => {
  it('stays silent when the clipped bound is the value the hide rule removes', () => {
    // show 200..500 + hide eq 200: the window really is "above 200", which no
    // inclusive integer bound can state — reporting 200 names a hidden value.
    expect(
      conditionsNarrow(
        { field: 'n', op: 'between', min: 200, max: 500 },
        { field: 'n', op: 'eq', value: 200 },
      ),
    ).toBeNull();
  });

  it('stays silent when the surviving window equals the show rule', () => {
    // hide `lt 0` removes nothing from show 0..100 — warning here would flag a
    // rule that is behaving correctly.
    expect(
      conditionsNarrow(
        { field: 'n', op: 'between', min: 0, max: 100 },
        { field: 'n', op: 'lt', value: 0 },
      ),
    ).toBeNull();
  });

  it('still reports the genuinely clipped cases', () => {
    expect(
      conditionsNarrow(
        { field: 'n', op: 'between', min: 200, max: 500 },
        { field: 'n', op: 'gt', value: 201 },
      ),
    ).toEqual({ lo: 200, hi: 201 });
    expect(
      conditionsNarrow(
        { field: 'n', op: 'between', min: 0, max: 100 },
        { field: 'n', op: 'lt', value: 50 },
      ),
    ).toEqual({ lo: 50, hi: 100 });
  });

  it('stays silent when the SURVIVING bound is an open (gt/lt) show edge', () => {
    // The mirror of the hide-side guard: an open show interval excludes its own
    // edge, so the inherited bound must not be named inclusively (V4-08).
    // show `gt 200` + hide `gt 500` survives 201..500 — reporting 200 names a
    // value `gt 200` hides.
    expect(
      conditionsNarrow(
        { field: 'n', op: 'gt', value: 200 },
        { field: 'n', op: 'gt', value: 500 },
      ),
    ).toBeNull();
    // show `lt 500` + hide `lt 200` survives 200..499 — reporting 500 names a
    // value `lt 500` hides.
    expect(
      conditionsNarrow(
        { field: 'n', op: 'lt', value: 500 },
        { field: 'n', op: 'lt', value: 200 },
      ),
    ).toBeNull();
  });

  it('a between show whose clipped edge stays inclusive is still reported', () => {
    // Guard must not over-suppress: a `between` show keeps inclusive edges, so
    // clipping the far end with an open hide still yields a nameable window.
    expect(
      conditionsNarrow(
        { field: 'n', op: 'between', min: 200, max: 500 },
        { field: 'n', op: 'gt', value: 400 },
      ),
    ).toEqual({ lo: 200, hi: 400 });
    expect(
      conditionsNarrow(
        { field: 'n', op: 'between', min: 200, max: 500 },
        { field: 'n', op: 'lt', value: 300 },
      ),
    ).toEqual({ lo: 300, hi: 500 });
  });

  it('every advisory it emits names bounds the runtime actually shows (exhaustive sweep)', () => {
    // The old guard only checked the hide side, so gt/gt and lt/lt pairs named a
    // value the SHOW rule excluded. Sweep every operand pair over an integer grid
    // and cross-check each emitted {lo,hi} against real visibility (visibleSteps):
    // the named endpoints MUST be visible, and one step past each MUST NOT be —
    // that is exactly what "only appears for lo–hi" claims.
    const OPS = ['eq', 'gt', 'lt', 'between'] as const;
    const GRID = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const mk = (op: (typeof OPS)[number], a: number, b: number): StepCondition =>
      op === 'between'
        ? { field: 'n', op, min: a, max: b }
        : { field: 'n', op, value: a };
    const visibleAt = (show: StepCondition, hide: StepCondition, v: number): boolean => {
      const cfg: FormConfig = {
        version: 1,
        steps: [step({ key: 'q', type: 'text', showWhen: show, hideWhen: hide })],
      };
      return visibleSteps(cfg, { n: v }).some((s) => s.key === 'q');
    };
    for (const sop of OPS) {
      for (const hop of OPS) {
        for (const sa of GRID) {
          for (const sb of GRID) {
            for (const ha of GRID) {
              for (const hb of GRID) {
                const show = mk(sop, sa, sb);
                const hide = mk(hop, ha, hb);
                const win = conditionsNarrow(show, hide);
                if (!win) continue;
                const label = `show ${sop}(${sa},${sb}) hide ${hop}(${ha},${hb}) → ${win.lo}..${win.hi}`;
                // Named bounds are genuinely visible…
                expect(visibleAt(show, hide, win.lo), `${label}: lo must be visible`).toBe(true);
                expect(visibleAt(show, hide, win.hi), `${label}: hi must be visible`).toBe(true);
                // …and the step immediately outside the window is not.
                expect(visibleAt(show, hide, win.lo - 1), `${label}: lo-1 must be hidden`).toBe(false);
                expect(visibleAt(show, hide, win.hi + 1), `${label}: hi+1 must be hidden`).toBe(false);
              }
            }
          }
        }
      }
    }
  });
});

describe('QA V5 follow-ups', () => {
  it('an inverted slider scoring range is unreachable whatever the bounds', () => {
    const s = step({ key: 'n', type: 'slider', min: 0, max: 100 });
    // sliderPoints matches `n >= min && n <= max` — empty when min > max.
    expect(sliderRangeUnreachable(s, { min: 80, max: 20, points: 5 })).toBe(true);
    expect(sliderRangeUnreachable(s, { min: 20, max: 80, points: 5 })).toBe(false);
    expect(computeScore(
      { version: 1, steps: [{ ...s, sliderScoring: [{ min: 80, max: 20, points: 5 }] }] },
      { n: 50 },
    )).toBe(0);
  });

  it('a free-text answer never scores, even with a legacy flat step.points', () => {
    // step.points has no builder UI and the Results breakdown never lists free
    // text, so a text/textarea answer must not contribute — otherwise the score
    // gains points shown and editable nowhere (V4-17). Choice/slider still score.
    const cfg: FormConfig = {
      version: 1,
      steps: [
        step({
          key: 'size',
          type: 'multiple_choice',
          options: [
            { label: 'SMB', value: 'smb', points: 3 },
            { label: 'Enterprise', value: 'ent', points: 10 },
          ],
        }),
        // Legacy injected flat points on free-text — must be ignored.
        { ...step({ key: 'why', type: 'text' }), points: 7 },
        { ...step({ key: 'notes', type: 'textarea' }), points: 4 },
      ],
    };
    // Only the choice contributes; the 7 + 4 free-text points are ignored.
    expect(computeScore(cfg, { size: 'ent', why: 'because', notes: 'long answer' })).toBe(10);
    expect(computeScore(cfg, { size: 'smb', why: 'x', notes: 'y' })).toBe(3);
  });

  it('renameStepKey moves the form-level ending tokens too', () => {
    const cfg: FormConfig = {
      version: 1,
      steps: [step({ key: 'company', type: 'text' })],
      ending: { headline: 'Thanks, [company]', body: 'We will call [company] soon.' },
    };
    const out = renameStepKey(cfg, 'company', 'org');
    expect(out.ending?.headline).toBe('Thanks, [org]');
    expect(out.ending?.body).toBe('We will call [org] soon.');
  });

  it('refuses a rename onto a name step’s subfield key', () => {
    const cfg: FormConfig = {
      version: 1,
      steps: [step({ key: 'who', type: 'name' }), step({ key: 'other', type: 'text' })],
    };
    // `firstname` is a real answer slot the name step writes — taking it would
    // make two steps collide on one answer.
    expect(renameStepKey(cfg, 'other', 'firstname')).toBe(cfg);
    expect(renameStepKey(cfg, 'other', 'lastname')).toBe(cfg);
    expect(renameStepKey(cfg, 'other', 'company').steps[1]!.key).toBe('company');
  });
});

describe('QA V5 — rules that can never hold', () => {
  it('flags a numeric op with no operand typed yet', () => {
    expect(conditionNeverHolds({ field: 'n', op: 'gt' })).toBe('missing_operand');
    expect(conditionNeverHolds({ field: 'n', op: 'between', min: 10 })).toBe('missing_operand');
    expect(conditionNeverHolds({ field: 'n', op: 'gt', value: 5 })).toBeNull();
  });

  it('flags a between whose bounds cross', () => {
    expect(conditionNeverHolds({ field: 'n', op: 'between', min: 500, max: 200 })).toBe('empty_interval');
    expect(conditionNeverHolds({ field: 'n', op: 'between', min: 200, max: 500 })).toBeNull();
  });

  it('flags a choice rule with nothing selected, and passes a filled one', () => {
    expect(conditionNeverHolds({ field: 'c', values: [] })).toBe('no_values');
    expect(conditionNeverHolds({ field: 'c', values: ['a'] })).toBeNull();
    expect(conditionNeverHolds(null)).toBeNull();
  });

  it('matches the runtime: a flagged SHOW rule really does hide the step forever', () => {
    const cfg: FormConfig = {
      version: 1,
      steps: [
        step({ key: 'n', type: 'slider', min: 0, max: 1000 }),
        step({ key: 'why', type: 'text', showWhen: { field: 'n', op: 'gt' } }),
      ],
    };
    for (const n of [0, 500, 1000]) {
      expect(visibleSteps(cfg, { n }).some((s) => s.key === 'why')).toBe(false);
    }
  });
});

describe('QA V5 — slider range hygiene', () => {
  it('flags a zero-travel slider', () => {
    expect(sliderHasNoTravel(step({ key: 'n', type: 'slider', min: 5, max: 5 }))).toBe(true);
    expect(sliderHasNoTravel(step({ key: 'n', type: 'slider', min: 0, max: 10 }))).toBe(false);
  });

  it('reports ranges overlapped by an earlier one — first listed wins at runtime', () => {
    const s = step({
      key: 'n',
      type: 'slider',
      min: 0,
      max: 100,
      sliderScoring: [
        { min: 0, max: 60, points: 1 },
        { min: 50, max: 100, points: 9 }, // overlaps 50..60
        { min: 61, max: 70, points: 3 }, // also inside the first two's shadow? no — 61..70 ⊂ 50..100
      ],
    });
    const overlapped = overlappingSliderRanges(s);
    expect(overlapped).toContain(1);
    // Runtime proof: 55 is in both row 0 and row 1, and row 0 wins.
    expect(computeScore({ version: 1, steps: [s] }, { n: 55 })).toBe(1);
  });

  it('does not flag adjacent, non-overlapping ranges', () => {
    const s = step({
      key: 'n',
      type: 'slider',
      min: 0,
      max: 100,
      sliderScoring: [
        { min: 0, max: 49, points: 0 },
        { min: 50, max: 100, points: 5 },
      ],
    });
    expect(overlappingSliderRanges(s)).toEqual([]);
  });
});

describe('QA V5 — variant rows that are not finished', () => {
  const base = step({
    key: 'q',
    type: 'text',
    question: 'Base question',
    questionField: 'tools',
  });

  it('an empty variant row falls back instead of publishing a blank question', () => {
    const s = { ...base, questionVariants: { 'a,b': '', '*': 'Fallback copy' } };
    expect(resolveQuestion(s, { tools: ['a', 'b'] })).toBe('Fallback copy');
  });

  it('an empty row with no fallback falls all the way back to the base question', () => {
    const s = { ...base, questionVariants: { a: '   ' } };
    expect(resolveQuestion(s, { tools: 'a' })).toBe('Base question');
  });

  it('two rows describing the same set resolve deterministically, not by tick order', () => {
    const s = { ...base, questionVariants: { 'ads,crm': 'ROW A', 'crm,ads': 'ROW B' } };
    const first = resolveQuestion(s, { tools: ['crm', 'ads'] });
    const second = resolveQuestion(s, { tools: ['ads', 'crm'] });
    expect(first).toBe(second);
  });
});

describe('reveal as a step type (V5-B3)', () => {
  const cfg: FormConfig = {
    version: 1,
    steps: [
      step({ key: 'q1', type: 'text', question: 'First?' }),
      step({ key: 'pause1', type: 'reveal', reveal: { enabled: true, headline: 'Matching…', durationMs: 900 } }),
      step({ key: 'q2', type: 'text', question: 'Second?' }),
      step({ key: 'pause2', type: 'reveal', reveal: { enabled: true, headline: 'Scoring…' } }),
    ],
  };

  it('a form can hold SEVERAL reveals, each with its own copy', () => {
    const reveals = cfg.steps.filter((s) => s.type === 'reveal');
    expect(reveals).toHaveLength(2);
    expect(reveals[0]!.reveal?.headline).toBe('Matching…');
    expect(reveals[1]!.reveal?.headline).toBe('Scoring…');
  });

  it('reveal steps are walked in order like any other step', () => {
    expect(visibleSteps(cfg, {}).map((s) => s.key)).toEqual(['q1', 'pause1', 'q2', 'pause2']);
  });

  it('collects no answer: never validated, never scored, never a recall token', () => {
    const rev = cfg.steps[1]!;
    expect(isInputlessStep(rev)).toBe(true);
    expect(validateAnswer(rev, undefined).ok).toBe(true);
    expect(validateAnswerCode(rev, undefined).ok).toBe(true);
    expect(computeScore(cfg, {})).toBe(0);
  });

  it('honors skip-logic, so a reveal can be conditional', () => {
    const conditional: FormConfig = {
      version: 1,
      steps: [
        step({ key: 'plan', type: 'dropdown', options: [{ label: 'Pro', value: 'pro' }, { label: 'Free', value: 'free' }] }),
        step({ key: 'pause', type: 'reveal', showWhen: { field: 'plan', values: ['pro'] } }),
      ],
    };
    expect(visibleSteps(conditional, { plan: 'pro' }).map((s) => s.key)).toEqual(['plan', 'pause']);
    expect(visibleSteps(conditional, { plan: 'free' }).map((s) => s.key)).toEqual(['plan']);
  });

  it('the LEGACY form-level reveal is untouched by any of this', () => {
    // A pre-B3 config keeps resolving its single interstitial exactly as before.
    const legacy: FormConfig = {
      version: 1,
      steps: [step({ key: 'a', type: 'text' }), step({ key: 'b', type: 'text' })],
      reveal: { enabled: true, headline: 'Legacy' },
      revealAfterStep: 1,
    };
    expect(revealAfterKey(legacy)).toBe('a');
  });
});

describe('scheduler step (V6)', () => {
  it('a required scheduler blocks Continue until booked; a booked value passes', () => {
    const s = step({ key: 'sched', type: 'scheduler', required: true });
    // No booking yet → the standard required check fires (the answer is the booking).
    expect(validateAnswerCode(s, undefined, {})).toEqual({ ok: false, code: 'required' });
    // A booked value (the meeting start time) satisfies it.
    expect(validateAnswerCode(s, '2026-01-01T10:00:00Z', {})).toEqual({ ok: true });
  });

  it('an optional scheduler can be skipped without booking', () => {
    const s = step({ key: 'sched', type: 'scheduler', required: false });
    expect(validateAnswerCode(s, undefined, {})).toEqual({ ok: true });
  });

  it('a scheduler answer never contributes to the score', () => {
    const cfg: FormConfig = {
      version: 1,
      scoring: { enabled: true },
      steps: [
        step({ key: 'sched', type: 'scheduler', required: true }),
        step({
          key: 'pick',
          type: 'multiple_choice',
          options: [{ label: 'A', value: 'a', points: 5 }],
        }),
      ],
    };
    expect(computeScore(cfg, { sched: '2026-01-01T10:00:00Z', pick: 'a' })).toBe(5);
  });

  it('a catch-all goto routes after a booking, which has no fixed value to match', () => {
    const cfg: FormConfig = {
      version: 1,
      steps: [
        step({ key: 'sched', type: 'scheduler', required: true, goto: [{ values: ['*'], target: null }] }),
        step({ key: 'later', type: 'text' }),
      ],
    };
    // Not booked → nothing matches; the walk continues linearly.
    expect(runtimeSteps(cfg, {}).map((s) => s.key)).toEqual(['sched', 'later']);
    // Booked → the catch-all ends the flow, so the scheduler IS the last step
    // and the renderer finalizes (booking → submit the form).
    expect(runtimeSteps(cfg, { sched: '2026-09-01T15:00:00.000Z' }).map((s) => s.key)).toEqual([
      'sched',
    ]);
  });

  it('a catch-all goto can jump forward instead of ending the form', () => {
    const cfg: FormConfig = {
      version: 1,
      steps: [
        step({ key: 'sched', type: 'scheduler', goto: [{ values: ['*'], target: 'end' }] }),
        step({ key: 'skipped', type: 'text' }),
        step({ key: 'end', type: 'text' }),
      ],
    };
    expect(runtimeSteps(cfg, { sched: '2026-09-01T15:00:00.000Z' }).map((s) => s.key)).toEqual([
      'sched',
      'end',
    ]);
  });

  it('a normal value-matching goto is unaffected by the catch-all support', () => {
    const cfg: FormConfig = {
      version: 1,
      steps: [
        step({
          key: 'pick',
          type: 'multiple_choice',
          options: [
            { label: 'A', value: 'a', points: 0 },
            { label: 'B', value: 'b', points: 0 },
          ],
          goto: [{ values: ['a'], target: null }],
        }),
        step({ key: 'later', type: 'text' }),
      ],
    };
    expect(runtimeSteps(cfg, { pick: 'a' }).map((s) => s.key)).toEqual(['pick']);
    expect(runtimeSteps(cfg, { pick: 'b' }).map((s) => s.key)).toEqual(['pick', 'later']);
  });
});
