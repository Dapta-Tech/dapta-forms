import { describe, it, expect } from 'vitest';
import {
  slugify,
  uniqueKey,
  defaultFlowGroup,
  createEmptyStep,
  createEmptyOutcome,
  hasScoringSignal,
  normalizeConfig,
} from './form-config';
// interpolate + resolveQuestion are unified in ./form-logic (shared by builder + runtime).
import { interpolate, resolveQuestion } from './form-logic';
import type { FormConfig, FormStep } from './form-logic';

const step = (p: Partial<FormStep> & Pick<FormStep, 'key' | 'type'>): FormStep => p;

describe('slugify', () => {
  it('lowercases, strips accents, and collapses non-alphanumerics', () => {
    expect(slugify('¿Cuál es tu Rol?')).toBe('cual_es_tu_rol');
    expect(slugify('  Hello  World  ')).toBe('hello_world');
  });
  it('falls back when nothing usable remains', () => {
    expect(slugify('!!!', 'step')).toBe('step');
    expect(slugify('')).toBe('item');
  });
});

describe('uniqueKey', () => {
  it('returns the base when free and suffixes on collision', () => {
    const taken = new Set(['role', 'role_2']);
    expect(uniqueKey('name', taken)).toBe('name');
    expect(uniqueKey('role', taken)).toBe('role_3');
  });
});

describe('defaultFlowGroup', () => {
  it('marks lead-capture field types, qualification otherwise', () => {
    expect(defaultFlowGroup('email')).toBe('lead_capture');
    expect(defaultFlowGroup('phone')).toBe('lead_capture');
    expect(defaultFlowGroup('name')).toBe('lead_capture');
    expect(defaultFlowGroup('dropdown')).toBe('qualification');
    expect(defaultFlowGroup('slider')).toBe('qualification');
  });
});

describe('createEmptyStep', () => {
  it('produces a valid step with a unique key and per-type defaults', () => {
    const drop = createEmptyStep('dropdown', new Set(['dropdown_1']));
    expect(drop.type).toBe('dropdown');
    expect(drop.key).not.toBe('dropdown_1');
    expect(drop.options).toHaveLength(1);
    expect(drop.flowGroup).toBe('qualification');

    const slider = createEmptyStep('slider');
    expect(slider.min).toBe(0);
    expect(slider.max).toBe(100);
    expect(slider.default).toBe(50);

    const msg = createEmptyStep('message');
    expect(msg.required).toBe(false);
    expect(msg.buttonText).toBeTruthy();

    const email = createEmptyStep('email');
    expect(email.flowGroup).toBe('lead_capture');
  });
});

describe('createEmptyOutcome', () => {
  it('mints a unique id', () => {
    const o = createEmptyOutcome(new Set(['outcome_1']));
    expect(o.id).toBeTruthy();
    expect(o.label).toBe('');
  });
});

describe('hasScoringSignal', () => {
  it('detects points, ranges, and outcomes', () => {
    expect(hasScoringSignal({ version: 1, steps: [] })).toBe(false);
    expect(
      hasScoringSignal({
        version: 1,
        steps: [step({ key: 'a', type: 'dropdown', options: [{ label: 'x', value: 'x', points: 3 }] })],
      }),
    ).toBe(true);
    expect(
      hasScoringSignal({ version: 1, steps: [], outcomes: [{ id: 'o', label: 'Hot', minScore: 5 }] }),
    ).toBe(true);
  });
});

describe('normalizeConfig', () => {
  it('dedupes step keys and rewrites references to renamed keys', () => {
    const config: FormConfig = {
      version: 1,
      steps: [
        step({ key: 'dup', type: 'dropdown', options: [{ label: 'A', value: 'a', points: 1 }] }),
        step({ key: 'dup', type: 'text' }), // collides → becomes dup_2
        step({ key: 'q3', type: 'text', showWhen: { field: 'dup', values: ['a'] } }),
      ],
    };
    const out = normalizeConfig(config);
    expect(out.steps.map((s) => s.key)).toEqual(['dup', 'dup_2', 'q3']);
    // The condition still points at the FIRST step (unchanged key).
    expect(out.steps[2].showWhen).toEqual({ field: 'dup', values: ['a'] });
  });

  it('generates keys for blank ones from the question', () => {
    const out = normalizeConfig({
      version: 1,
      steps: [step({ key: '', type: 'text', question: 'What is your budget?' })],
    });
    expect(out.steps[0].key).toBe('what_is_your_budget');
  });

  it('derives flowGroup and fills option values, and derives scoring', () => {
    const out = normalizeConfig({
      version: 1,
      steps: [
        step({ key: 'email', type: 'email' }),
        step({
          key: 'role',
          type: 'dropdown',
          options: [
            { label: 'Founder', value: '', points: 10 },
            { label: 'Founder', value: '', points: 0 }, // dup slug → founder_2
          ],
        }),
      ],
    });
    expect(out.steps[0].flowGroup).toBe('lead_capture');
    expect(out.steps[1].flowGroup).toBe('qualification');
    expect(out.steps[1].options?.map((o) => o.value)).toEqual(['founder', 'founder_2']);
    expect(out.scoring).toEqual({ enabled: true });
  });

  it('sorts outcomes by minScore ascending and keeps unique ids', () => {
    const out = normalizeConfig({
      version: 1,
      steps: [],
      outcomes: [
        { id: 'hot', label: 'Hot', minScore: 20 },
        { id: 'cold', label: 'Cold', minScore: 0 },
      ],
    });
    expect(out.outcomes?.map((o) => o.minScore)).toEqual([0, 20]);
  });

  it('preserves additive top-level fields (reveal, partial submit, unknown extras)', () => {
    const config = {
      version: 1,
      steps: [step({ key: 'role', type: 'dropdown', options: [{ label: 'A', value: 'a' }] })],
      reveal: { enabled: true, headline: 'Hold on…', durationMs: 3000, prewarm: true },
      partialSubmitAfterStep: 2,
      // Additive fields the engine doesn't model (tracking/destinations) must
      // survive a normalize→save round-trip untouched.
      tracking: { gtmId: 'GTM-XYZ' },
    } as FormConfig;
    const out = normalizeConfig(config) as FormConfig & Record<string, unknown>;
    expect(out.reveal).toEqual({ enabled: true, headline: 'Hold on…', durationMs: 3000, prewarm: true });
    expect(out.partialSubmitAfterStep).toBe(2);
    expect(out.tracking).toEqual({ gtmId: 'GTM-XYZ' });
    expect(normalizeConfig(out)).toEqual(out);
  });

  it('respects an explicit scoring flag and is idempotent', () => {
    const config: FormConfig = {
      version: 1,
      scoring: { enabled: false },
      steps: [step({ key: 'role', type: 'dropdown', options: [{ label: 'A', value: 'a', points: 5 }] })],
    };
    const once = normalizeConfig(config);
    expect(once.scoring).toEqual({ enabled: false });
    expect(normalizeConfig(once)).toEqual(once);
  });
});

describe('interpolate', () => {
  it('replaces [field] tokens with answers, joining arrays', () => {
    expect(interpolate('Hi [name], budget [budget]?', { name: 'Ada', budget: 500 })).toBe(
      'Hi Ada, budget 500?',
    );
    expect(interpolate('Picked [tools]', { tools: ['a', 'b'] })).toBe('Picked a, b');
    expect(interpolate('Hi [missing]', {})).toBe('Hi ');
  });
});

describe('resolveQuestion', () => {
  const s = step({
    key: 'detail',
    type: 'text',
    question: 'Tell us more',
    questionField: 'role',
    questionVariants: { founder: 'Tell us about [company]', '*': 'Tell us about your work' },
  });
  it('picks the variant matching the referenced answer, interpolated', () => {
    expect(resolveQuestion(s, { role: 'founder', company: 'Acme' })).toBe('Tell us about Acme');
  });
  it('falls back to * then to the plain question', () => {
    expect(resolveQuestion(s, { role: 'student' })).toBe('Tell us about your work');
    expect(resolveQuestion({ ...s, questionVariants: { founder: 'x' } }, { role: 'student' })).toBe(
      'Tell us more',
    );
  });
});
