/**
 * Validation of the additive `destinations` config section (@quill/types). These
 * guard the contract the admin UI writes and the API re-validates.
 */
import { describe, it, expect } from 'vitest';
import { formConfigSchema, formDestinationSchema } from '@quill/types';

describe('formConfigSchema destinations (additive)', () => {
  it('accepts a config with NO destinations (legacy configs unaffected)', () => {
    const r = formConfigSchema.safeParse({ version: 1, steps: [] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.destinations).toBeUndefined();
  });

  it('accepts a webhook destination and defaults enabled=false', () => {
    const r = formDestinationSchema.safeParse({
      type: 'webhook',
      settings: { url: 'https://acme.io/hook', secret: 'shh' },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.enabled).toBe(false);
  });

  it('rejects a webhook destination with a non-URL', () => {
    const r = formDestinationSchema.safeParse({
      type: 'webhook',
      enabled: true,
      settings: { url: 'not-a-url' },
    });
    expect(r.success).toBe(false);
  });

  it('accepts a hubspot destination with mappings + score/date properties', () => {
    const r = formDestinationSchema.safeParse({
      type: 'hubspot',
      enabled: true,
      fieldMappings: { email_step: 'email', name_step: 'firstname' },
      utmMappings: { utm_source: 'hs_analytics_source' },
      scoreProperty: 'lead_score',
      dateProperty: 'submitted_date',
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.type === 'hubspot') {
      expect(r.data.fieldMappings.email_step).toBe('email');
      expect(r.data.settings).toEqual({});
    }
  });

  it('rejects an unknown destination type (discriminated union)', () => {
    expect(formDestinationSchema.safeParse({ type: 'sheets', settings: {} }).success).toBe(false);
  });

  it('round-trips inside a full form config', () => {
    const r = formConfigSchema.safeParse({
      version: 1,
      steps: [],
      destinations: [
        { type: 'webhook', enabled: true, settings: { url: 'https://acme.io/h' } },
        { type: 'hubspot', enabled: false, fieldMappings: { e: 'email' } },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.destinations).toHaveLength(2);
  });
});
