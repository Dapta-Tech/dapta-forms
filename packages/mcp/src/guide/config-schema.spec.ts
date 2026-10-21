import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import { createEmptyStep, normalizeConfig, type FormConfig as EngineConfig } from '@quill/engine';
import { formConfigSchema } from '@quill/types';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { EDITOR_DEFAULT_FIELDS, formConfigJsonSchema, KEPT_AS_READ_FIELDS, UNSUPPORTED_CONFIG_FIELDS } from './config-schema';
import { EXAMPLE_CONFIGS, QUIZ_CONFIG } from './examples';

/** Does `path` (dot segments, `[]` for array items) resolve to a property anywhere in `schema`? */
function hasField(schema: unknown, path: string): boolean {
  const segments = path.split('.');
  const walk = (node: unknown, i: number): boolean => {
    if (!node || typeof node !== 'object') return false;
    const n = node as Record<string, unknown>;
    for (const key of ['anyOf', 'oneOf', 'allOf']) {
      if (Array.isArray(n[key]) && (n[key] as unknown[]).some((m) => walk(m, i))) return true;
    }
    const segment = segments[i]!;
    if (segment === '[]') return walk(n.items, i + 1);
    const props = n.properties as Record<string, unknown> | undefined;
    if (!props || !(segment in props)) return false;
    return i === segments.length - 1 ? true : walk(props[segment], i + 1);
  };
  return walk(schema, 0);
}

const ajv = new Ajv({ allErrors: true, strict: false });

describe('formConfigJsonSchema', () => {
  const schema = formConfigJsonSchema();

  it('is a valid draft-07 JSON Schema that compiles', () => {
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(ajv.validateSchema(schema)).toBe(true);
    expect(() => ajv.compile(schema)).not.toThrow();
  });

  it('carries none of the fields the editor has no control for, but the defaults it writes itself', () => {
    const raw = zodToJsonSchema(formConfigSchema, { $refStrategy: 'none' });
    for (const path of UNSUPPORTED_CONFIG_FIELDS) {
      // Present in the source schema, so the test cannot pass by a typo.
      expect(hasField(raw, path), `${path} in formConfigSchema`).toBe(true);
      expect(hasField(schema, path), `${path} in the published schema`).toBe(
        path in EDITOR_DEFAULT_FIELDS || path in KEPT_AS_READ_FIELDS,
      );
    }
  });

  it('accepts a config as the API answers it: the editor defaults and untitled content steps', () => {
    // What the builder adds and the API returns after normalizing: a derived
    // `flowGroup` on every step, `buttonText` "Continue" on a message,
    // `reveal.enabled` and `scheduler.prefill`, and blank titles on the steps
    // that may go without one.
    const read = normalizeConfig({
      version: 1,
      steps: [
        { key: 'email', type: 'email', question: 'Email?' },
        createEmptyStep('message'),
        createEmptyStep('reveal'),
        createEmptyStep('scheduler'),
      ],
    } as EngineConfig);
    const validate = ajv.compile(schema);
    expect(validate(read), ajv.errorsText(validate.errors)).toBe(true);
  });

  it('accepts a config read from a form born from a template or the brand kit', () => {
    // The API sends back a slider's `sliderUnitLabel` and `branding.clientLogos`
    // when they equal what the form stores, and the skill tells the agent to
    // send them back as read, so the schema must not refuse them.
    const read = {
      ...QUIZ_CONFIG,
      steps: [
        ...QUIZ_CONFIG.steps,
        { key: 'team_size', type: 'slider', question: 'How big is your team?', min: 1, max: 50, sliderUnitLabel: 'people' },
      ],
      branding: { clientLogos: [{ name: 'Example' }] },
    };
    const validate = ajv.compile(schema);
    expect(validate(read), ajv.errorsText(validate.errors)).toBe(true);
    expect(formConfigSchema.safeParse(read).success).toBe(true);
  });

  it('still rejects any other value for those defaults', () => {
    const validate = ajv.compile(schema);
    const withStep = (over: Record<string, unknown>) => ({
      ...QUIZ_CONFIG,
      steps: QUIZ_CONFIG.steps.map((s, i) => (i === 0 ? { ...s, ...over } : s)),
    });
    expect(validate(withStep({ flowGroup: 'scoring' }))).toBe(false);
    expect(validate(withStep({ type: 'reveal', reveal: { enabled: false } }))).toBe(false);
    expect(validate(withStep({ type: 'scheduler', scheduler: { provider: 'calendly', prefill: false } }))).toBe(false);
  });

  it('keeps the controlled look-alikes the strip must not touch', () => {
    // `cover.clientLogos` has a control (the marquee); only `branding.clientLogos` does not.
    expect(hasField(schema, 'cover.clientLogos')).toBe(true);
    expect(hasField(schema, 'steps.[].reveal.headline')).toBe(true);
    expect(hasField(schema, 'destinations.[].settings.url')).toBe(true);
    expect(hasField(schema, 'outcomes.[].message')).toBe(true);
  });

  it('inlines every sub-schema, so removing a field cannot leave a dangling $ref', () => {
    expect(JSON.stringify(schema)).not.toContain('"$ref"');
  });

  it('requires steps, which the API refuses to lose on a PUT', () => {
    expect(schema.required).toEqual(expect.arrayContaining(['version', 'steps']));
  });

  it('accepts every config the recipes show, and the API accepts them too', () => {
    const validate = ajv.compile(schema);
    for (const [name, config] of Object.entries(EXAMPLE_CONFIGS)) {
      expect(validate(config), `${name}: ${ajv.errorsText(validate.errors)}`).toBe(true);
      expect(formConfigSchema.safeParse(config).success, name).toBe(true);
    }
  });

  it('rejects a config that uses an unsupported field', () => {
    const validate = ajv.compile(schema);
    const withButtonText = {
      ...QUIZ_CONFIG,
      steps: QUIZ_CONFIG.steps.map((s, i) => (i === 0 ? { ...s, buttonText: 'Go' } : s)),
    };
    expect(validate(withButtonText)).toBe(false);
    expect(validate({ ...QUIZ_CONFIG, revealAfterStep: 2 })).toBe(false);
    expect(validate({ version: 1 })).toBe(false);
  });
});
