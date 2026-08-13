/**
 * The value pickers, rendered through `HubspotCard` for real.
 *
 * `property-options.spec.ts` proves WHICH values are offered; this file proves
 * the UI reaches that conclusion — that a picklist becomes a dropdown and
 * everything else stays a text box, that a fanned-out question falls back to
 * text with a hint saying why, and that a filled value-map group is born
 * collapsed.
 *
 * Rendered with `renderToStaticMarkup` because these components use hooks (the
 * web suite runs in plain node — see `vitest.config.ts`).
 *
 * The shared `Select` renders only its TRIGGER until it is opened, so its option
 * list is not in this markup. Asserting on the trigger's visible label is not a
 * workaround — it is the stronger assertion: the label shown for a value proves
 * the picker resolved that value against the list it was given, which is exactly
 * what these functions decide.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ContactKeyReadiness } from '@quill/engine';
import { getMessages } from '@quill/shared';
import type { HubSpotProperty } from '@/lib/admin-api';
import { HubspotCard } from './integrations-editor';

const m = getMessages('en').admin.integrations;

const ready: ContactKeyReadiness = {
  ok: true,
  blocker: null,
  source: { kind: 'question', key: 'email' },
} as ContactKeyReadiness;

const PROPERTIES: HubSpotProperty[] = [
  { name: 'email', label: 'Email', type: 'string' },
  {
    name: 'hs_role',
    label: 'Role',
    type: 'enumeration',
    options: [
      { value: 'ic', label: 'Individual contributor' },
      { value: 'manager', label: 'Manager' },
    ],
  },
  {
    name: 'jobtitle_enum',
    label: 'Job title',
    type: 'enumeration',
    // Overlaps hs_role on `manager` only.
    options: [
      { value: 'manager', label: 'People manager' },
      { value: 'founder', label: 'Founder' },
    ],
  },
];

type Over = {
  pickerEnabled?: boolean;
  properties?: HubSpotProperty[];
  fieldMappings?: { key: string; property: string }[];
  valueMaps?: { stepKey: string; rows: { from: string; to: string }[] }[];
  staticProperties?: { key: string; value: string }[];
};

function markup(over: Over = {}): string {
  return renderToStaticMarkup(
    <HubspotCard
      state={{
        enabled: true,
        fieldMappings: over.fieldMappings ?? [],
        utmMappings: {},
        scoreProperty: '',
        dateProperty: '',
        note: true,
        formActivity: false,
        valueMaps: over.valueMaps ?? [],
        outcomeProperty: '',
        staticProperties: over.staticProperties ?? [],
        inferCompanyFromEmail: false,
        bookingSync: {
          stageProperty: '',
          stageValue: '',
          dateProperty: '',
          hoursProperty: '',
          dateTimezone: '',
        },
      }}
      onChange={() => {}}
      properties={over.properties ?? PROPERTIES}
      pickerEnabled={over.pickerEnabled ?? true}
      accountConnected
      showMapping
      extraHubspotStored={false}
      readiness={ready}
      questions={[
        { key: 'email', type: 'email', label: 'Email' },
        { key: 'role', type: 'dropdown', label: 'Your role' },
      ]}
      formId="form-1"
      m={m}
    />,
  );
}

/**
 * The markup of one labelled control — from its own opening tag through the
 * text the user sees, which is enough to tell a dropdown trigger
 * (`aria-haspopup="listbox"`) from an `<input>`.
 */
function controlFor(html: string, ariaLabel: string): string {
  const at = html.indexOf(`aria-label="${ariaLabel}"`);
  expect(at, `no control labelled ${ariaLabel}`).toBeGreaterThan(-1);
  const from = html.lastIndexOf('<', at);
  const end = html.indexOf('</button>', at);
  return html.slice(from, end === -1 ? at + 400 : end);
}

const isDropdown = (control: string) => control.includes('aria-haspopup="listbox"');
const isTextBox = (control: string) => control.trimStart().startsWith('<input');

describe('static property values', () => {
  it('an enumeration property gets a dropdown, showing the label AND the written value', () => {
    const html = markup({ staticProperties: [{ key: 'hs_role', value: 'manager' }] });
    const control = controlFor(html, m.staticValue);
    expect(isDropdown(control)).toBe(true);
    // Both, because they differ and the second is what actually reaches HubSpot.
    expect(control).toContain('Manager (manager)');
  });

  it('an empty value on an enumeration shows the prompt, not a blank box', () => {
    const html = markup({ staticProperties: [{ key: 'hs_role', value: '' }] });
    expect(controlFor(html, m.staticValue)).toContain(m.selectValue);
  });

  it('a text property keeps the free-text box it has always had', () => {
    const html = markup({ staticProperties: [{ key: 'email', value: 'ops@acme.test' }] });
    expect(isTextBox(controlFor(html, m.staticValue))).toBe(true);
  });

  it('a value the picklist does not contain opens in TEXT mode showing that value', () => {
    // The regression this guards: a hand-typed legacy value must not render as
    // an empty dropdown — configured, still saved, and looking unset.
    const html = markup({ staticProperties: [{ key: 'hs_role', value: 'Gerente' }] });
    const control = controlFor(html, m.staticValue);
    expect(isTextBox(control)).toBe(true);
    expect(control).toContain('Gerente');
  });

  it('with the picker unavailable every value is free text', () => {
    const html = markup({
      pickerEnabled: false,
      properties: [],
      staticProperties: [{ key: 'hs_role', value: 'manager' }],
    });
    expect(isTextBox(controlFor(html, m.staticValue))).toBe(true);
  });
});

describe('value-map groups', () => {
  it('a group with filled rows is born COLLAPSED, with the count in the header', () => {
    const html = markup({
      valueMaps: [
        {
          stepKey: 'role',
          rows: [
            { from: 'Boss', to: 'manager' },
            { from: 'Doer', to: 'ic' },
            // A trailing blank row is scaffolding, not a configured translation.
            { from: '', to: '' },
          ],
        },
      ],
    });
    expect(html).toContain('data-testid="valuemap-group"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('2 value(s)');
    // Collapsed means the rows really are not rendered — otherwise nothing above
    // is evidence of anything.
    expect(html).not.toContain(`aria-label="${m.valueMapCrmValue}"`);
  });

  it('a group with nothing filled in opens — there is nothing to summarise', () => {
    for (const stepKey of ['', 'role']) {
      const html = markup({ valueMaps: [{ stepKey, rows: [{ from: '', to: '' }] }] });
      expect(html, `stepKey=${stepKey || '(none)'}`).toContain('aria-expanded="true"');
      expect(html).toContain(`aria-label="${m.valueMapCrmValue}"`);
    }
  });

  it('one enumeration target → the right side is that property’s dropdown', () => {
    const html = markup({
      fieldMappings: [{ key: 'role', property: 'hs_role' }],
      valueMaps: [{ stepKey: 'role', rows: [{ from: '', to: '' }] }],
    });
    expect(isDropdown(controlFor(html, m.valueMapCrmValue))).toBe(true);
    expect(html).toContain('Values are written to: hs_role');
    // The LEFT side is the answer as the form stores it — always free text.
    expect(isTextBox(controlFor(html, m.valueMapAnswer))).toBe(true);
  });

  it('an unmapped question gets free text and says why', () => {
    const html = markup({ valueMaps: [{ stepKey: 'role', rows: [{ from: '', to: '' }] }] });
    expect(isTextBox(controlFor(html, m.valueMapCrmValue))).toBe(true);
    expect(html).toContain(m.valueMapNoTarget);
  });

  // These use blank rows on purpose: a filled group renders collapsed (proved
  // above), and `renderToStaticMarkup` cannot click the chevron open. Which
  // values survive the intersection is `property-options.spec.ts`'s job; what
  // matters here is that the UI ends up with the right KIND of control and
  // names its targets.

  it('fan-out to two overlapping enumerations still offers a dropdown, and names both', () => {
    const html = markup({
      fieldMappings: [
        { key: 'role', property: 'hs_role' },
        { key: 'role', property: 'jobtitle_enum' },
      ],
      valueMaps: [{ stepKey: 'role', rows: [{ from: '', to: '' }] }],
    });
    expect(html).toContain('Values are written to: hs_role, jobtitle_enum');
    expect(isDropdown(controlFor(html, m.valueMapCrmValue))).toBe(true);
  });

  it('fan-out where one target is free text falls back to free text', () => {
    const html = markup({
      fieldMappings: [
        { key: 'role', property: 'hs_role' },
        { key: 'role', property: 'email' },
      ],
      valueMaps: [{ stepKey: 'role', rows: [{ from: '', to: '' }] }],
    });
    expect(html).toContain('Values are written to: hs_role, email');
    expect(isTextBox(controlFor(html, m.valueMapCrmValue))).toBe(true);
  });
});
