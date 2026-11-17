/**
 * The HighLevel destination's contract: what parses, what is refused, the
 * one-per-form rule, and that configs stored before it read exactly as they did.
 */
import { describe, expect, it } from 'vitest';
import {
  extraOnePerFormDestination,
  formConfigSchema,
  formDestinationSchema,
  GOHIGHLEVEL_MAPPABLE_DATA_TYPES,
  GOHIGHLEVEL_STANDARD_FIELD_KEYS,
  GOHIGHLEVEL_STANDARD_FIELDS,
  hasExtraDestinationOfType,
  isGoHighLevelMappableDataType,
  ONE_GOHIGHLEVEL_DESTINATION_MESSAGE,
  ONE_HUBSPOT_DESTINATION_MESSAGE,
  ONE_SALESFORCE_DESTINATION_MESSAGE,
} from './index';

const custom = (id: string, dataType: string, key = `contact.${id}`) => ({ kind: 'custom', id, key, dataType });

describe('gohighlevel destination', () => {
  it('parses with defaults: switched off, nothing mapped, no events (complete only)', () => {
    expect(formDestinationSchema.parse({ type: 'gohighlevel' })).toEqual({
      type: 'gohighlevel',
      enabled: false,
      fieldMappings: {},
      utmMappings: {},
    });
  });

  it('keeps every field of a full config exactly as written', () => {
    const full = {
      type: 'gohighlevel',
      enabled: true,
      events: ['partial', 'complete'],
      fieldMappings: {
        email: [{ kind: 'standard', field: 'email' }],
        firstname: [{ kind: 'standard', field: 'firstName' }],
        budget: [custom('f1', 'NUMERICAL'), { kind: 'standard', field: 'companyName' }],
        interests: [custom('f2', 'MULTIPLE_OPTIONS')],
      },
      utmMappings: { utm_source: custom('u1', 'TEXT'), utm_campaign: custom('u2', 'LARGE_TEXT') },
      scoreField: custom('s1', 'NUMERICAL'),
      dateField: custom('d1', 'DATE'),
      dayTimezone: 'America/Bogota',
      staticFields: [
        { target: { kind: 'standard', field: 'country' }, value: 'CO' },
        { target: custom('f3', 'SINGLE_OPTIONS'), value: 'Web' },
      ],
      tags: ['dforms', 'lead'],
      source: 'dForms: Demo',
      drafts: {
        mappings: [{ key: 'phone', target: null }],
        statics: [{ target: null, value: 'x' }],
      },
    };
    expect(formDestinationSchema.parse(full)).toEqual(full);
  });

  it('refuses a custom field of a type the upsert does not take', () => {
    for (const dataType of ['TEXTBOX_LIST', 'FLOAT', 'SIGNATURE', 'FILE_UPLOAD', 'TIME', 'SOMETHING_NEW']) {
      const entry = { type: 'gohighlevel', fieldMappings: { q: [custom('f', dataType)] } };
      expect(formDestinationSchema.safeParse(entry).success, dataType).toBe(false);
      expect(isGoHighLevelMappableDataType(dataType), dataType).toBe(false);
    }
    for (const dataType of GOHIGHLEVEL_MAPPABLE_DATA_TYPES) expect(isGoHighLevelMappableDataType(dataType)).toBe(true);
  });

  it('refuses the score, the date and a UTM on a custom field that cannot hold them', () => {
    // Each one alone is what makes the entry invalid.
    const valid = { scoreField: custom('s', 'NUMERICAL'), dateField: custom('d', 'DATE'), utmMappings: { utm_source: custom('u', 'TEXT') } };
    expect(formDestinationSchema.safeParse({ type: 'gohighlevel', ...valid }).success).toBe(true);
    const refused = [
      { scoreField: custom('s', 'TEXT') },
      { scoreField: { kind: 'standard', field: 'email' } },
      { dateField: custom('d', 'TEXT') },
      { utmMappings: { utm_source: custom('u', 'NUMERICAL') } },
      { utmMappings: { utm_source: { kind: 'standard', field: 'website' } } },
      { utmMappings: { gclid: custom('u', 'TEXT') } },
    ];
    for (const extra of refused) {
      expect(formDestinationSchema.safeParse({ type: 'gohighlevel', ...extra }).success, JSON.stringify(extra)).toBe(
        false,
      );
    }
  });

  it('refuses a standard field that is not in the catalog, and an empty target list', () => {
    expect(
      formDestinationSchema.safeParse({ type: 'gohighlevel', fieldMappings: { q: [{ kind: 'standard', field: 'email' }] } })
        .success,
    ).toBe(true);
    expect(
      formDestinationSchema.safeParse({ type: 'gohighlevel', fieldMappings: { q: [{ kind: 'standard', field: 'dnd' }] } })
        .success,
    ).toBe(false);
    expect(formDestinationSchema.safeParse({ type: 'gohighlevel', fieldMappings: { q: [] } }).success).toBe(false);
  });

  it('lists every standard field once, in the catalog order, each with at least one source', () => {
    expect(GOHIGHLEVEL_STANDARD_FIELDS.map((f) => f.key)).toEqual([...GOHIGHLEVEL_STANDARD_FIELD_KEYS]);
    for (const f of GOHIGHLEVEL_STANDARD_FIELDS) expect(f.sources.length, f.key).toBeGreaterThan(0);
  });

  it('refuses ADDING a second HighLevel destination, but not re-saving two that are stored', () => {
    const one = [{ type: 'gohighlevel' }];
    const two = [{ type: 'gohighlevel' }, { type: 'gohighlevel' }];
    expect(extraOnePerFormDestination(one)).toBeNull();
    expect(extraOnePerFormDestination(two)).toEqual({ type: 'gohighlevel', message: ONE_GOHIGHLEVEL_DESTINATION_MESSAGE });
    expect(extraOnePerFormDestination(two, two)).toBeNull();
    expect(hasExtraDestinationOfType('gohighlevel', [{ type: 'salesforce' }, { type: 'gohighlevel' }])).toBe(false);
  });

  it('keeps the HubSpot and Salesforce one-per-form rules and messages as they were', () => {
    const hubspot = { type: 'hubspot' };
    const salesforce = { type: 'salesforce' };
    expect(extraOnePerFormDestination([hubspot, hubspot])).toEqual({
      type: 'hubspot',
      message: ONE_HUBSPOT_DESTINATION_MESSAGE,
    });
    expect(extraOnePerFormDestination([salesforce, salesforce, { type: 'gohighlevel' }])).toEqual({
      type: 'salesforce',
      message: ONE_SALESFORCE_DESTINATION_MESSAGE,
    });
    // Webhooks and spreadsheets have no such rule.
    expect(extraOnePerFormDestination([{ type: 'webhook' }, { type: 'webhook' }, { type: 'google-sheets' }, { type: 'google-sheets' }])).toBeNull();
  });
});

describe('configs stored before HighLevel', () => {
  // One entry of every kind, as each was stored before this change: no
  // `events` on a CRM entry, because the schema did not have it there.
  const legacy = [
    { type: 'webhook', enabled: true, events: ['complete'], settings: { url: 'https://example.com/h' } },
    {
      type: 'hubspot',
      enabled: true,
      settings: { note: true },
      fieldMappings: { email: 'email', role: ['jobtitle', 'role__c'] },
      utmMappings: { utm_source: 'source' },
    },
    {
      type: 'google-sheets',
      enabled: true,
      settings: { spreadsheetId: 'sheet-1' },
      columns: [{ header: 'Email', source: 'answer', key: 'email' }],
    },
    { type: 'salesforce', enabled: true, fieldMappings: { email: 'Email' }, utmMappings: {} },
  ];

  it('parse to exactly what was stored, next to a HighLevel entry', () => {
    const ghl = {
      type: 'gohighlevel',
      enabled: true,
      fieldMappings: { email: [{ kind: 'standard', field: 'email' }] },
      utmMappings: {},
    };
    const parsed = formConfigSchema.parse({ version: 1, steps: [], destinations: [...legacy, ghl] });
    // Byte for byte: no default filled in, no `events` key gained.
    expect(parsed.destinations).toEqual([...legacy, ghl]);
  });
});
