import { describe, it, expect } from 'vitest';
import {
  visibleSteps,
  validateAnswer,
  validateAnswerCode,
  computeScore,
  resolveOutcome,
  isPersonalEmail,
  orderSteps,
  interpolate,
  resolveStepDisplay,
  runtimeSteps,
  isMultiSelect,
  partialSubmitKey,
  nameFields,
  isSafeHttpUrl,
  isSafeImageUrl,
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

describe('isPersonalEmail', () => {
  it('flags free-mail domains and passes corporate ones', () => {
    expect(isPersonalEmail('a@gmail.com')).toBe(true);
    expect(isPersonalEmail('a@hotmail.co.uk')).toBe(true);
    expect(isPersonalEmail('a@acme.io')).toBe(false);
    expect(isPersonalEmail(null)).toBe(false);
    expect(isPersonalEmail(123)).toBe(false);
  });
});

describe('orderSteps', () => {
  it('puts qualification before lead_capture, preserving order within a phase', () => {
    const steps: FormStep[] = [
      step({ key: 'email', type: 'email', flowGroup: 'lead_capture' }),
      step({ key: 'q1', type: 'text', flowGroup: 'qualification' }),
      step({ key: 'phone', type: 'phone', flowGroup: 'lead_capture' }),
      step({ key: 'q2', type: 'text' }), // no group → qualification
    ];
    expect(orderSteps(steps).map((s) => s.key)).toEqual(['q1', 'q2', 'email', 'phone']);
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
  it('substitutes [key] tokens, removing unknown/empty tokens', () => {
    expect(interpolate('Hi [firstname]!', { firstname: 'Ada' })).toBe('Hi Ada!');
    expect(interpolate('Hi [firstname]!', {})).toBe('Hi !');
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
  it('orders two-phase, applies skip-logic, and resolves display', () => {
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
    expect(walked.map((s) => s.key)).toEqual(['problem', 'detail', 'email']);
    expect(walked[1].question).toBe('Tell us more about leads.');
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
