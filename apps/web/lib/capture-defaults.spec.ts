/**
 * Default answers, and the precedence that makes them safe.
 *
 * The rule is default < URL < what the person types. A campaign link carrying
 * `?email=` has to beat a default the author configured months earlier — if the
 * default won, the link would silently do nothing and nobody would notice until
 * the leads came back wrong.
 */
import { describe, it, expect } from 'vitest';
import type { FormStep } from '@quill/engine';
import { captureDefaults } from '../app/[accountCode]/[handle]/[slug]/renderer-shared';

const step = (partial: Partial<FormStep> & Pick<FormStep, 'key' | 'type'>): FormStep => partial;

describe('captureDefaults', () => {
  it('seeds nothing when no step declares a default', () => {
    expect(captureDefaults([step({ key: 'a', type: 'text' })])).toEqual({});
  });

  it('seeds the declared defaults by field key', () => {
    const steps = [
      step({ key: 'plan', type: 'dropdown', defaultValue: 'pro' }),
      step({ key: 'notes', type: 'textarea' }),
    ];
    expect(captureDefaults(steps)).toEqual({ plan: 'pro' });
  });

  it('ignores an empty default rather than seeding an empty answer', () => {
    expect(captureDefaults([step({ key: 'a', type: 'text', defaultValue: '' })])).toEqual({});
  });

  it('skips a message step, which captures no answer at all', () => {
    const steps = [step({ key: 'intro', type: 'message', defaultValue: 'x' })];
    expect(captureDefaults(steps)).toEqual({});
  });

  it('skips a name step — it writes two subfields, so one default has nowhere to go', () => {
    const steps = [step({ key: 'who', type: 'name', defaultValue: 'Ana' })];
    expect(captureDefaults(steps)).toEqual({});
  });

  it('loses to a URL value for the same key — the whole point of the ordering', () => {
    const steps = [step({ key: 'email', type: 'email', defaultValue: 'default@acme.test' })];
    const fromUrl = { email: 'ana@acme.test' };
    // Exactly how both renderers merge the two.
    const seed = { ...captureDefaults(steps), ...fromUrl };
    expect(seed.email).toBe('ana@acme.test');
  });
});
