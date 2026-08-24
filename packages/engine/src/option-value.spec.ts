/**
 * An option's `value` follows its `label`, and every pointer follows the value.
 *
 * The value is the token stored as the answer, so it is what conditions, jumps,
 * dynamic-question variants and outcome overrides all name by string. None of
 * them complain when they stop matching: a branch simply never fires again. That
 * silence is why the rename is one function with a suite rather than an
 * assignment at four call sites.
 */
import { describe, expect, it } from 'vitest';
import {
  isDerivedOptionValue,
  lockedOptionValues,
  renameOptionValue,
  setOptionLabel,
} from './form-config';
import type { FormConfig } from './form-logic';

/** A form whose every option-value pointer is populated, so a rename has to move all of them. */
function config(): FormConfig {
  return {
    version: 1,
    steps: [
      {
        key: 'size',
        type: 'multiple_choice',
        question: 'Company size?',
        options: [
          { label: 'Under 50', value: 'under_50', points: 1 },
          { label: 'Over 50', value: 'over_50', points: 5 },
        ],
        goto: [{ values: ['over_50'], target: 'budget' }],
      },
      {
        key: 'budget',
        type: 'multiple_choice',
        question: 'Budget?',
        showWhen: { field: 'size', values: ['over_50'] },
        options: [{ label: 'Yes', value: 'yes' }],
      },
      {
        key: 'detail',
        type: 'text',
        question: 'Tell us more',
        hideWhen: { field: 'size', values: ['under_50'] },
        questionField: 'size',
        questionVariants: { over_50: 'What does your team need?', '*': 'Tell us more' },
        sliderLabelVariants: { over_50: 'seats' },
      },
    ],
    outcomes: [
      { id: 'hot', label: 'Hot', minScore: 5, overrides: [{ field: 'size', values: ['over_50'] }] },
    ],
  } as unknown as FormConfig;
}

describe('isDerivedOptionValue', () => {
  it('treats an empty value and the slug of the label as the builder’s to write', () => {
    expect(isDerivedOptionValue({ label: 'Over 50', value: '' })).toBe(true);
    expect(isDerivedOptionValue({ label: 'Over 50', value: 'over_50' })).toBe(true);
  });

  it('treats the created placeholder as unwritten, so a stuck form heals', () => {
    // The whole reported symptom: labels read properly, values all read
    // `option_N`. The slug test alone calls these hand-written and would freeze
    // them that way forever.
    expect(isDerivedOptionValue({ label: 'Over 50 employees', value: 'option_3' })).toBe(true);
  });

  it('leaves a hand-written value alone', () => {
    // The case the whole "auto" heuristic exists to protect: a value chosen to
    // match something outside this form, like a CRM enum.
    expect(isDerivedOptionValue({ label: 'Over 50', value: 'ENTERPRISE_TIER' })).toBe(false);
    expect(isDerivedOptionValue({ label: '1 mes', value: '4 mes' })).toBe(false);
  });
});

describe('renameOptionValue', () => {
  it('moves the value and every pointer aimed at it', () => {
    const out = renameOptionValue(config(), 'size', 'over_50', 'more_than_50');

    expect(out.steps[0].options?.map((o) => o.value)).toEqual(['under_50', 'more_than_50']);
    expect(out.steps[0].goto?.[0].values).toEqual(['more_than_50']);
    expect(out.steps[1].showWhen?.values).toEqual(['more_than_50']);
    expect(out.steps[2].questionVariants).toEqual({
      more_than_50: 'What does your team need?',
      '*': 'Tell us more',
    });
    expect(out.steps[2].sliderLabelVariants).toEqual({ more_than_50: 'seats' });
    expect(out.outcomes?.[0].overrides?.[0].values).toEqual(['more_than_50']);
  });

  it('leaves pointers at OTHER values, and at other steps, alone', () => {
    const out = renameOptionValue(config(), 'size', 'over_50', 'more_than_50');

    expect(out.steps[2].hideWhen?.values).toEqual(['under_50']);
    // `budget` has its own option called `yes`; renaming on `size` must not
    // reach into a step it does not own.
    expect(out.steps[1].options?.[0].value).toBe('yes');
  });

  it('reaches inside a comma-joined multi-select variant key', () => {
    // A multi-select variant is keyed by the whole answer, joined with commas.
    // Matching only whole keys would leave every combination key dangling.
    const base = config();
    base.steps[2].questionVariants = { 'under_50,over_50': 'Mixed', over_50: 'Big' };

    const out = renameOptionValue(base, 'size', 'over_50', 'big');

    expect(out.steps[2].questionVariants).toEqual({ 'under_50,big': 'Mixed', big: 'Big' });
  });

  it('refuses to merge two options onto one token', () => {
    // Not a rename: `under_50` already exists, so this would make two distinct
    // answers indistinguishable. Losing data is worse than refusing.
    const before = config();
    expect(renameOptionValue(before, 'size', 'over_50', 'under_50')).toBe(before);
  });

  it('is a no-op for an empty target, an unchanged value or an unknown step', () => {
    const before = config();
    expect(renameOptionValue(before, 'size', 'over_50', '')).toBe(before);
    expect(renameOptionValue(before, 'size', 'over_50', 'over_50')).toBe(before);
    expect(renameOptionValue(before, 'nope', 'over_50', 'x')).toBe(before);
  });
});

describe('setOptionLabel', () => {
  it('carries the value along, pointers included', () => {
    const out = setOptionLabel(config(), 'size', 1, 'More than 50');

    expect(out.steps[0].options?.[1]).toMatchObject({ label: 'More than 50', value: 'more_than_50' });
    expect(out.steps[1].showWhen?.values).toEqual(['more_than_50']);
    expect(out.steps[0].goto?.[0].values).toEqual(['more_than_50']);
  });

  it('leaves a hand-written value where it is', () => {
    const base = config();
    base.steps[0].options![1].value = 'ENTERPRISE_TIER';

    const out = setOptionLabel(base, 'size', 1, 'More than 50');

    expect(out.steps[0].options?.[1]).toMatchObject({
      label: 'More than 50',
      value: 'ENTERPRISE_TIER',
    });
  });

  it('leaves a LOCKED value where it is, however derived it looks', () => {
    // Published, or mapped to a CRM enum. The label still changes; the token
    // stored against every answer already collected does not.
    const out = setOptionLabel(config(), 'size', 1, 'More than 50', new Set(['over_50']));

    expect(out.steps[0].options?.[1]).toMatchObject({ label: 'More than 50', value: 'over_50' });
    expect(out.steps[1].showWhen?.values).toEqual(['over_50']);
  });

  it('dedupes against siblings rather than colliding', () => {
    const base = config();
    base.steps[0].options = [
      { label: 'Yes', value: 'yes' },
      { label: 'Maybe', value: 'maybe' },
    ];

    const out = setOptionLabel(base, 'size', 1, 'Yes');

    expect(out.steps[0].options?.map((o) => o.value)).toEqual(['yes', 'yes_2']);
  });

  it('holds the value still while the label is empty mid-typing', () => {
    // Slugifying '' would fall back to a placeholder, which is a rename nobody
    // asked for and would fire the moment somebody selects-all and retypes.
    const out = setOptionLabel(config(), 'size', 1, '');

    expect(out.steps[0].options?.[1]).toMatchObject({ label: '', value: 'over_50' });
  });

  it('heals a form whose values are stuck on the created placeholder', () => {
    const base = config();
    base.steps[0].options = [{ label: 'Over 50 employees', value: 'option_2' }];

    const out = setOptionLabel(base, 'size', 0, 'Over 50 employees!');

    expect(out.steps[0].options?.[0].value).toBe('over_50_employees');
  });
});

describe('lockedOptionValues', () => {
  it('locks nothing on the empty config the builder creates a form with', () => {
    // The whole reason the gate can be "is it live" rather than "was it
    // published": a new form serves nothing, so everything built before the
    // first publish is free to follow its label.
    expect(lockedOptionValues({ version: 1, steps: [] } as never)).toEqual({});
  });

  it('locks every option value the live config serves', () => {
    expect(lockedOptionValues(config())).toEqual({
      size: ['under_50', 'over_50'],
      budget: ['yes'],
    });
  });

  it('does not lock an option that is only in the draft', () => {
    // Added to a live form after publishing: no answer can carry it and no
    // mapping points at it, so its value still follows its label.
    const live = config();
    live.steps[0].options = [{ label: 'Under 50', value: 'under_50' }];

    expect(lockedOptionValues(live).size).toEqual(['under_50']);
  });

  it('locks a value a HubSpot mapping points at', () => {
    const mapped = {
      version: 1,
      steps: [],
      destinations: [
        { type: 'hubspot', enabled: true, valueMaps: { size: { over_50: 'ENTERPRISE' } } },
      ],
    };

    expect(lockedOptionValues(mapped as never)).toEqual({ size: ['over_50'] });
  });

  it('degrades to nothing locked on a config it cannot read', () => {
    // This runs in the builder's first render. A stale or hand-edited blob must
    // not throw there.
    expect(lockedOptionValues(null)).toEqual({});
    expect(lockedOptionValues({ destinations: 'nonsense' })).toEqual({});
    expect(lockedOptionValues({ destinations: [{ type: 'hubspot', valueMaps: null }] })).toEqual({});
  });
});
