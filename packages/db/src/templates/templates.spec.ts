/**
 * The templates are AUTHORED configs, not generated ones, so nothing else stops
 * them drifting out of the v1 contract — a typo'd step type or a missing option
 * value would ship and only fail on the one screen a new user cannot skip.
 * Re-validating each of them here is what keeps that impossible.
 */
import { describe, it, expect } from 'vitest';
import {
  formConfigSchema,
  FORM_TEMPLATE_IDS,
  USE_CASE_TEMPLATE,
  ONBOARDING_USE_CASES,
  type FormTemplateId,
} from '@quill/types';
import { FORM_TEMPLATES, getFormTemplate } from './index';

describe('FORM_TEMPLATES', () => {
  it('has an entry for every declared template id', () => {
    expect(Object.keys(FORM_TEMPLATES).sort()).toEqual([...FORM_TEMPLATE_IDS].sort());
  });

  it.each(FORM_TEMPLATE_IDS.filter((id) => id !== 'blank'))(
    '%s parses against the v1 config contract',
    (id) => {
      const result = formConfigSchema.safeParse(FORM_TEMPLATES[id].config);
      // Surface zod's own message on failure — "false !== true" would send the
      // next person hunting through a 90-line config by hand.
      expect(result.success ? null : result.error.issues).toBeNull();
    },
  );

  it('leaves `blank` without a config so it tracks the dashboard default', () => {
    expect(FORM_TEMPLATES.blank.config).toBeNull();
  });

  it.each(FORM_TEMPLATE_IDS)('%s has a non-empty name', (id) => {
    expect(FORM_TEMPLATES[id].name.trim().length).toBeGreaterThan(0);
  });

  it.each(FORM_TEMPLATE_IDS.filter((id) => id !== 'blank'))('%s asks at least one question', (id) => {
    expect(FORM_TEMPLATES[id].config?.steps.length ?? 0).toBeGreaterThan(0);
  });

  it.each(FORM_TEMPLATE_IDS.filter((id) => id !== 'blank'))(
    '%s uses unique step keys',
    (id) => {
      // Duplicate keys silently collapse two questions into one answer.
      const keys = (FORM_TEMPLATES[id].config?.steps ?? []).map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
    },
  );

  it('only declares outcomes on the template that enables scoring', () => {
    // An outcome bucket without scoring never resolves past the first range, so
    // the author sees dead config they did not write.
    for (const id of FORM_TEMPLATE_IDS) {
      const config = FORM_TEMPLATES[id].config;
      if (!config?.outcomes?.length) continue;
      expect(config.scoring?.enabled, `${id} declares outcomes`).toBe(true);
    }
  });
});

describe('USE_CASE_TEMPLATE', () => {
  it('covers every use case', () => {
    expect(Object.keys(USE_CASE_TEMPLATE).sort()).toEqual([...ONBOARDING_USE_CASES].sort());
  });

  it('maps every non-`other` use case to a real template', () => {
    for (const useCase of ONBOARDING_USE_CASES) {
      const mapped = USE_CASE_TEMPLATE[useCase];
      if (useCase === 'other') {
        // `other` pre-selects nothing on purpose: we do not know what they want,
        // so guessing would put the wrong card under their cursor.
        expect(mapped).toBeNull();
        continue;
      }
      expect(mapped).not.toBeNull();
      expect(getFormTemplate(mapped as FormTemplateId)).toBeDefined();
    }
  });

  it('never pre-selects the blank form', () => {
    // "Start from scratch" has to be chosen, never defaulted into — it is the
    // one option that hands the person an empty screen.
    expect(Object.values(USE_CASE_TEMPLATE)).not.toContain('blank');
  });
});

describe('getFormTemplate', () => {
  it('resolves a known id', () => {
    expect(getFormTemplate('lead-qualifier')).toBe(FORM_TEMPLATES['lead-qualifier']);
  });

  it('returns undefined for an unknown id', () => {
    expect(getFormTemplate('not-a-template')).toBeUndefined();
  });

  it('returns undefined for an inherited Object property', () => {
    // The id arrives in a request body, so `FORM_TEMPLATES[id]` alone would
    // resolve 'constructor' or 'toString' to a function and crash the handler.
    expect(getFormTemplate('constructor')).toBeUndefined();
    expect(getFormTemplate('__proto__')).toBeUndefined();
    expect(getFormTemplate('toString')).toBeUndefined();
  });
});
