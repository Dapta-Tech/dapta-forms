import { describe, expect, it } from 'vitest';
import type { HubSpotProperty } from '@/lib/admin-api';
import {
  isCustomValue,
  optionsForProperty,
  sharedOptionsFor,
  targetPropertiesFor,
} from './property-options';

const PROPERTIES: HubSpotProperty[] = [
  { name: 'email', label: 'Email', type: 'string' },
  {
    name: 'hs_role',
    label: 'Role',
    type: 'enumeration',
    options: [
      { value: 'ic', label: 'Individual contributor' },
      { value: 'manager', label: 'Manager' },
      { value: 'exec', label: 'Executive' },
    ],
  },
  {
    name: 'jobtitle_enum',
    label: 'Job title',
    type: 'enumeration',
    // Overlaps hs_role on manager/exec only, and in a DIFFERENT order.
    options: [
      { value: 'exec', label: 'C-level' },
      { value: 'manager', label: 'People manager' },
      { value: 'founder', label: 'Founder' },
    ],
  },
  {
    name: 'lifecyclestage',
    label: 'Lifecycle stage',
    type: 'enumeration',
    options: [{ value: 'lead', label: 'Lead' }],
  },
];

describe('optionsForProperty', () => {
  it('returns the options of an enumeration property', () => {
    expect(optionsForProperty(PROPERTIES, 'hs_role')?.map((o) => o.value)).toEqual([
      'ic',
      'manager',
      'exec',
    ]);
  });

  it('returns undefined for a text property, a blank name, and an unknown name', () => {
    expect(optionsForProperty(PROPERTIES, 'email')).toBeUndefined();
    expect(optionsForProperty(PROPERTIES, '')).toBeUndefined();
    expect(optionsForProperty(PROPERTIES, '   ')).toBeUndefined();
    // An author may type a property the picker has never seen (env fallback,
    // stale cache). Free text, not an empty dropdown they can't type into.
    expect(optionsForProperty(PROPERTIES, 'not_a_property')).toBeUndefined();
  });

  it('keeps HubSpot’s own order — never alphabetises', () => {
    expect(optionsForProperty(PROPERTIES, 'hs_role')?.map((o) => o.label)).toEqual([
      'Individual contributor',
      'Manager',
      'Executive',
    ]);
  });
});

describe('targetPropertiesFor', () => {
  const mappings = [
    { key: 'role', property: 'hs_role' },
    { key: 'email', property: 'email' },
    { key: 'role', property: 'jobtitle_enum' },
    { key: 'role', property: '  ' },
    { key: 'role', property: 'hs_role' },
  ];

  it('collects every property a question fans out to, de-duplicated', () => {
    expect(targetPropertiesFor(mappings, 'role')).toEqual(['hs_role', 'jobtitle_enum']);
  });

  it('is empty for an unmapped key and for a blank key', () => {
    expect(targetPropertiesFor(mappings, 'company')).toEqual([]);
    expect(targetPropertiesFor(mappings, '')).toEqual([]);
  });
});

describe('sharedOptionsFor', () => {
  it('with no targets there is nothing to constrain the value', () => {
    expect(sharedOptionsFor(PROPERTIES, [])).toBeUndefined();
  });

  it('a single enumeration target yields its own options', () => {
    expect(sharedOptionsFor(PROPERTIES, ['hs_role'])?.map((o) => o.value)).toEqual([
      'ic',
      'manager',
      'exec',
    ]);
  });

  it('a single text target yields nothing (free text)', () => {
    expect(sharedOptionsFor(PROPERTIES, ['email'])).toBeUndefined();
  });

  it('fan-out intersects — a value valid for only one target is a partial write', () => {
    const shared = sharedOptionsFor(PROPERTIES, ['hs_role', 'jobtitle_enum']);
    // `ic` is hs_role-only and `founder` is jobtitle-only: both are excluded.
    expect(shared?.map((o) => o.value)).toEqual(['manager', 'exec']);
    // Labels + order come from the FIRST target, not the second.
    expect(shared?.map((o) => o.label)).toEqual(['Manager', 'Executive']);
  });

  it('fan-out where any target is free text falls back to free text', () => {
    expect(sharedOptionsFor(PROPERTIES, ['hs_role', 'email'])).toBeUndefined();
    expect(sharedOptionsFor(PROPERTIES, ['email', 'hs_role'])).toBeUndefined();
    expect(sharedOptionsFor(PROPERTIES, ['hs_role', 'not_a_property'])).toBeUndefined();
  });

  it('fan-out with an empty intersection falls back to free text, not an empty list', () => {
    // Two enumerations that share nothing: there is no value the adapter could
    // write to both, so offering a dropdown would offer only wrong answers.
    expect(sharedOptionsFor(PROPERTIES, ['hs_role', 'lifecyclestage'])).toBeUndefined();
  });
});

describe('isCustomValue', () => {
  const opts = optionsForProperty(PROPERTIES, 'hs_role');

  it('a value that is not in the list opens the text escape hatch', () => {
    // The exact regression this exists for: a config typed by hand before the
    // picker existed must show what it holds, not render as unset.
    expect(isCustomValue(opts, 'Gerente')).toBe(true);
  });

  it('a listed value, an empty value, and no options at all are not custom', () => {
    expect(isCustomValue(opts, 'manager')).toBe(false);
    expect(isCustomValue(opts, '')).toBe(false);
    expect(isCustomValue(undefined, 'anything')).toBe(false);
  });

  it('matches on value, not on label — the label is not what gets written', () => {
    expect(isCustomValue(opts, 'Manager')).toBe(true);
  });
});
