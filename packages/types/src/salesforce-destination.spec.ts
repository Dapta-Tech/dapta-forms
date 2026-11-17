/**
 * The Salesforce destination's contract: what parses, when it fires, and the
 * one-per-form authoring rule.
 */
import { describe, expect, it } from 'vitest';
import {
  destinationFiresForPhase,
  formConfigSchema,
  formDestinationSchema,
  hasExtraSalesforceDestination,
} from './index';

describe('salesforce destination', () => {
  it('parses with defaults, and keeps every optional field', () => {
    expect(formDestinationSchema.parse({ type: 'salesforce' })).toEqual({
      type: 'salesforce',
      enabled: false,
      fieldMappings: {},
      utmMappings: {},
    });
    const full = {
      type: 'salesforce',
      enabled: true,
      fieldMappings: { email: 'Email', role: ['Title', 'Role__c'] },
      utmMappings: { utm_source: 'LeadSource_Detail__c' },
      scoreField: 'Form_Score__c',
      dateField: 'Submitted__c',
      dayTimezone: 'America/Bogota',
      staticFields: { LeadSource: 'dForms' },
    };
    expect(formDestinationSchema.parse(full)).toEqual(full);
  });

  it('fires on complete submissions only', () => {
    expect(destinationFiresForPhase({ type: 'salesforce' }, 'complete')).toBe(true);
    expect(destinationFiresForPhase({ type: 'salesforce' }, 'partial')).toBe(false);
  });

  it('a config without Salesforce reads exactly as before', () => {
    const config = { destinations: [{ type: 'webhook', enabled: true, settings: { url: 'https://example.com/h' } }] };
    const parsed = formConfigSchema.safeParse({ ...minimalConfig(), ...config });
    expect(parsed.success).toBe(true);
  });

  it('refuses ADDING a second Salesforce destination, but not re-saving two that are stored', () => {
    const one = [{ type: 'salesforce' }];
    const two = [{ type: 'salesforce' }, { type: 'salesforce' }];
    expect(hasExtraSalesforceDestination(one)).toBe(false);
    expect(hasExtraSalesforceDestination(two)).toBe(true);
    expect(hasExtraSalesforceDestination(two, two)).toBe(false);
    expect(hasExtraSalesforceDestination([{ type: 'hubspot' }, { type: 'salesforce' }])).toBe(false);
  });
});

function minimalConfig() {
  return formConfigSchema.parse({ version: 1, steps: [] } as unknown);
}
