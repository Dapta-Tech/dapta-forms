import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import { formConfigSchema } from '@quill/types';
import { GUIDE_EXAMPLES, GUIDE_PARTS, GUIDE_STEP_TYPES, formGuide } from './guide';
import { formConfigJsonSchema } from './config-schema';
import { FORM_FIELD_TYPES } from '@quill/engine';

describe('formGuide', () => {
  it('serves every part on "all", and only the asked part otherwise', () => {
    const all = formGuide();
    expect(all.rules?.length).toBeGreaterThan(5);
    expect(all.config_schema).toEqual(formConfigJsonSchema());
    expect(all.examples).toBe(GUIDE_EXAMPLES);
    expect(Object.keys(formGuide('examples')).sort()).toEqual(['examples', 'part']);
    expect(Object.keys(formGuide('config_schema')).sort()).toEqual(['config_schema', 'part']);
    expect(Object.keys(formGuide('rules')).sort()).toEqual(['lifecycle', 'logic', 'part', 'rules', 'step_types']);
    expect(GUIDE_PARTS).toContain('all');
  });

  it('names every step type the engine knows, and no other', () => {
    expect(GUIDE_STEP_TYPES.map((t) => t.type).sort()).toEqual([...FORM_FIELD_TYPES].sort());
  });

  it('only shows examples the published schema and the API both accept', () => {
    const validate = new Ajv({ allErrors: true, strict: false, logger: false }).compile(formConfigJsonSchema());
    for (const ex of GUIDE_EXAMPLES) {
      expect(validate(ex.config), `${ex.name}: ${JSON.stringify(validate.errors)}`).toBe(true);
      expect(formConfigSchema.safeParse(ex.config).success, ex.name).toBe(true);
    }
  });

  it('carries no vendor host and no em dash in any text it serves or any source file', () => {
    const text = JSON.stringify(formGuide());
    expect(text).not.toMatch(/\u2014|\u2015/);
    const here = fileURLToPath(new URL('.', import.meta.url));
    const sources = [...readdirSync(here).map((f) => join(here, f)), ...readdirSync(join(here, '..')).map((f) => join(here, '..', f))]
      .filter((f) => f.endsWith('.ts'));
    for (const file of sources) expect(readFileSync(file, 'utf8'), file).not.toMatch(/\.dapta\.(ai|dev|com)/i);
  });
});
