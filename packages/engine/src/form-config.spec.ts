import { describe, it, expect } from 'vitest';
import {
  slugify,
  uniqueKey,
  defaultFlowGroup,
  createEmptyStep,
  createEmptyOutcome,
  hasScoringSignal,
  normalizeConfig,
  migrateRevealToStep,
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
    // Empty/missing token is swept up with its orphaned trailing space (no "Hi ").
    expect(interpolate('Hi [missing]', {})).toBe('Hi');
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

describe('createEmptyStep — scheduler (V6)', () => {
  it('seeds a Calendly scheduler that is required and prefilled, unconfigured until picked', () => {
    const s = createEmptyStep('scheduler', new Set());
    expect(s.type).toBe('scheduler');
    expect(s.required).toBe(true); // a scheduler must be booked unless the author turns it off
    expect(s.scheduler).toEqual({ provider: 'calendly', prefill: true });
    expect(s.scheduler?.url == null).toBe(true); // no event type picked yet
  });
});

describe('migrateRevealToStep', () => {
  const base = (over: Partial<FormConfig> = {}): FormConfig => ({
    version: 1,
    steps: [
      step({ key: 'email', type: 'email' }),
      step({ key: 'budget', type: 'slider' }),
      step({ key: 'role', type: 'dropdown' }),
    ],
    ...over,
  });

  it('leaves a config with no legacy reveal untouched — same object, so callers can identity-check', () => {
    const config = base();
    expect(migrateRevealToStep(config)).toBe(config);
  });

  it('folds the form-level copy into a reveal STEP at the position it played', () => {
    const next = migrateRevealToStep(
      base({
        reveal: { enabled: true, headline: 'Matching you…', durationMs: 1800, prewarm: true },
        revealAfterStep: 2, // after `budget`
      }),
    );
    expect(next.steps.map((s) => s.type)).toEqual(['email', 'slider', 'reveal', 'dropdown']);
    expect(next.steps[2]?.reveal).toEqual({
      enabled: true,
      headline: 'Matching you…',
      subtitle: '',
      durationMs: 1800,
      prewarm: true,
    });
    // The legacy shape is gone, so nothing can author or play it twice.
    expect('reveal' in next).toBe(false);
    expect('revealAfterStep' in next).toBe(false);
  });

  it('defaults to the END when no position was pinned — where an enabled reveal already played', () => {
    const next = migrateRevealToStep(base({ reveal: { enabled: true } }));
    expect(next.steps.map((s) => s.type)).toEqual(['email', 'slider', 'dropdown', 'reveal']);
  });

  it('honors the legacy per-step triggersReveal position, and strips the flag', () => {
    const config = base();
    config.steps[0] = { ...config.steps[0]!, triggersReveal: true };
    const next = migrateRevealToStep({ ...config, reveal: { enabled: true } });
    expect(next.steps.map((s) => s.type)).toEqual(['email', 'reveal', 'slider', 'dropdown']);
    expect(next.steps.some((s) => s.triggersReveal)).toBe(false);
  });

  it('collapses subtitleTemplate onto subtitle — it won at runtime and both interpolate', () => {
    const next = migrateRevealToStep(
      base({ reveal: { enabled: true, subtitle: 'plain', subtitleTemplate: 'Finding [role]…' } }),
    );
    expect(next.steps.at(-1)?.reveal?.subtitle).toBe('Finding [role]…');
  });

  it('adds NO step for a disabled reveal — it never played — but still drops the legacy fields', () => {
    const next = migrateRevealToStep(base({ reveal: { enabled: false }, revealAfterStep: 1 }));
    expect(next.steps.some((s) => s.type === 'reveal')).toBe(false);
    expect('reveal' in next).toBe(false);
    expect('revealAfterStep' in next).toBe(false);
  });

  it('is idempotent — a second pass is a no-op, so re-opening the builder never stacks reveals', () => {
    const once = migrateRevealToStep(base({ reveal: { enabled: true } }));
    const twice = migrateRevealToStep(once);
    expect(twice).toBe(once);
    expect(twice.steps.filter((s) => s.type === 'reveal')).toHaveLength(1);
  });

  it('gives the new step a key that cannot collide with an existing one', () => {
    const config = base();
    config.steps.push(step({ key: 'reveal_1', type: 'text' }));
    const next = migrateRevealToStep({ ...config, reveal: { enabled: true } });
    const keys = next.steps.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never invents a reveal for a form with no steps', () => {
    const next = migrateRevealToStep({ version: 1, steps: [], reveal: { enabled: true } });
    expect(next.steps).toEqual([]);
  });
});

describe('normalizeConfig — logicLayout (builder-only node positions)', () => {
  const at = (x: number, y: number) => ({ x, y });

  it('keeps a position whose step still exists', () => {
    const next = normalizeConfig({
      version: 1,
      steps: [{ key: 'budget', type: 'text', question: 'Budget?' }],
      logicLayout: { budget: at(120, 40) },
    });
    expect(next.logicLayout).toEqual({ budget: at(120, 40) });
  });

  it('drops a position whose step is gone, so no node is pinned to nothing', () => {
    const next = normalizeConfig({
      version: 1,
      steps: [{ key: 'budget', type: 'text', question: 'Budget?' }],
      logicLayout: { budget: at(120, 40), deleted_step: at(999, 999) },
    });
    expect(next.logicLayout).toEqual({ budget: at(120, 40) });
  });

  it('follows the same rename map the goto targets follow', () => {
    // Two steps want the key `budget`; the second is suffixed, and its stored
    // position has to move with it or it lands on the FIRST step's node.
    const next = normalizeConfig({
      version: 1,
      steps: [
        { key: 'budget', type: 'text', question: 'A' },
        { key: 'budget', type: 'text', question: 'B' },
      ],
      logicLayout: { budget: at(10, 10) },
    });
    const keys = next.steps.map((s) => s.key);
    expect(new Set(Object.keys(next.logicLayout ?? {}))).toEqual(new Set([keys[0]!]));
  });

  it('drops the field entirely when nothing survives, rather than storing {}', () => {
    const next = normalizeConfig({
      version: 1,
      steps: [{ key: 'budget', type: 'text', question: 'Budget?' }],
      logicLayout: { gone: at(1, 2) },
    });
    expect('logicLayout' in next).toBe(false);
  });

  it('leaves a config without positions untouched — every legacy form', () => {
    const next = normalizeConfig({
      version: 1,
      steps: [{ key: 'budget', type: 'text', question: 'Budget?' }],
    });
    expect('logicLayout' in next).toBe(false);
  });
});

describe('normalizeConfig — logicLayout outcome-node pins', () => {
  const at = (x: number, y: number) => ({ x, y });
  const base = {
    version: 1 as const,
    steps: [{ key: 'q1', type: 'text' as const, question: 'Q?' }],
    outcomes: [{ id: 'hot', label: 'Hot', minScore: 5 }],
  };

  it('keeps a pin on an outcome that still exists — dragging a terminal node must survive autosave', () => {
    const next = normalizeConfig({ ...base, logicLayout: { 'outcome:hot': at(900, -40) } });
    expect(next.logicLayout).toEqual({ 'outcome:hot': at(900, -40) });
  });

  it('prunes a pin whose outcome was deleted', () => {
    const next = normalizeConfig({ ...base, logicLayout: { 'outcome:gone': at(1, 1) } });
    expect('logicLayout' in next).toBe(false);
  });

  it('never confuses an outcome key with a step key under the rename map', () => {
    // Two steps colliding on `q1` triggers the rename path; the outcome pin
    // must pass through it untouched — outcome ids are not step keys.
    const next = normalizeConfig({
      version: 1,
      steps: [
        { key: 'q1', type: 'text', question: 'A' },
        { key: 'q1', type: 'text', question: 'B' },
      ],
      outcomes: [{ id: 'hot', label: 'Hot', minScore: 5 }],
      logicLayout: { q1: at(10, 10), 'outcome:hot': at(700, 0) },
    });
    expect(next.logicLayout?.['outcome:hot']).toEqual(at(700, 0));
  });
});
