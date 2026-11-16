// @vitest-environment happy-dom
/**
 * The Salesforce card, from the author's side, and the state it saves.
 *
 * Pinned here: what is stored round-trips exactly (opening the tab must never
 * rewrite a destination nobody touched), half-filled rows never reach the
 * config, and the card says out loud the three things a delivery would
 * otherwise only reveal in the CRM: no Email mapped, the placeholders a new
 * Lead gets, and the fields a matched Contact will skip.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getMessages } from '@quill/shared';
import type { FormDestination } from '@quill/types';
import type { SalesforceFieldsResponse } from '@/lib/admin-api';
import type { QuestionMeta } from './auto-map';

const actions = vi.hoisted(() => ({ salesforceFieldsAction: vi.fn() }));
vi.mock('./actions', () => actions);

import {
  builtSalesforce,
  initialSalesforce,
  SalesforceCard,
  salesforceWarnings,
  type SalesforceState,
} from './salesforce-card';

const m = getMessages('en').admin.integrations;
const QUESTIONS: QuestionMeta[] = [
  { key: 'email', label: 'Work email', type: 'email' },
  { key: 'last', label: 'Last name', type: 'short_text' },
  { key: 'seats', label: 'Seats', type: 'number' },
];
const FIELDS: SalesforceFieldsResponse = {
  enabled: true,
  cached: false,
  lead: [
    { name: 'Company', label: 'Company', type: 'string', required: true },
    { name: 'Email', label: 'Email', type: 'email', required: false },
    { name: 'LastName', label: 'Last Name', type: 'string', required: true },
    {
      name: 'LeadSource',
      label: 'Lead Source',
      type: 'picklist',
      required: false,
      options: [{ value: 'Web', label: 'Web' }, { value: 'Partner', label: 'Partner' }],
    },
    { name: 'Seats__c', label: 'Seats', type: 'double', required: false },
    { name: 'Submitted__c', label: 'Submitted', type: 'date', required: false },
    { name: 'Submitted_At__c', label: 'Submitted at', type: 'datetime', required: false },
  ],
  contact: ['Email', 'LastName'],
};

const base = (over: Partial<SalesforceState> = {}): SalesforceState => ({
  enabled: true,
  mappings: [],
  utm: {},
  scoreField: '',
  dateField: '',
  dayTimezone: '',
  statics: [],
  ...over,
});

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function mount(state: SalesforceState, opts: { connected?: boolean; fields?: SalesforceFieldsResponse } = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <SalesforceCard
        state={state}
        setState={() => {}}
        questions={QUESTIONS}
        connected={opts.connected ?? true}
        initialFields={opts.fields ?? FIELDS}
        locale="en"
        m={m}
      />,
    );
  });
  return container;
}

describe('stored state', () => {
  it('round-trips a stored destination exactly', () => {
    const stored: FormDestination = {
      type: 'salesforce',
      enabled: true,
      fieldMappings: { email: 'Email', last: ['LastName', 'Surname__c'] },
      utmMappings: { utm_source: 'Source__c' },
      scoreField: 'Seats__c',
      dateField: 'Submitted__c',
      dayTimezone: 'America/Bogota',
      staticFields: { LeadSource: 'Web' },
    };
    expect(builtSalesforce(initialSalesforce([stored]))).toEqual(stored);
  });

  it('stores nothing for an untouched, switched-off card', () => {
    expect(builtSalesforce(initialSalesforce([]))).toBeNull();
  });

  it('drops half-filled rows instead of storing them', () => {
    const built = builtSalesforce(
      base({
        mappings: [{ key: 'email', field: 'Email' }, { key: 'last', field: '' }, { key: '', field: 'Company' }],
        statics: [{ field: 'LeadSource', value: '' }],
      }),
    );
    expect(built).toEqual({ type: 'salesforce', enabled: true, fieldMappings: { email: 'Email' }, utmMappings: {} });
  });

  it('keeps a time zone only beside a date field', () => {
    expect(builtSalesforce(base({ dayTimezone: 'America/Bogota' }))).not.toHaveProperty('dayTimezone');
    expect(builtSalesforce(base({ dateField: 'Submitted__c', dayTimezone: 'America/Bogota' }))).toMatchObject({
      dayTimezone: 'America/Bogota',
    });
  });
});

describe('what the card warns about', () => {
  it('flags a missing Email mapping', () => {
    expect(salesforceWarnings(base(), FIELDS.enabled ? FIELDS.contact : []).emailMissing).toBe(true);
    expect(
      salesforceWarnings(base({ mappings: [{ key: 'email', field: 'Email' }] }), []).emailMissing,
    ).toBe(false);
  });

  it('names the required Lead fields a new Lead will get placeholders for', () => {
    const w = salesforceWarnings(base({ mappings: [{ key: 'last', field: 'LastName' }] }), []);
    expect(w.fallbacks).toEqual(['Company']);
  });

  it('lists the mapped fields a matched Contact does not have', () => {
    const w = salesforceWarnings(
      base({
        mappings: [
          { key: 'email', field: 'Email' },
          { key: 'last', field: 'LastName' },
          { key: 'seats', field: 'Seats__c' },
        ],
        statics: [{ field: 'LeadSource', value: 'Web' }],
      }),
      ['Email', 'LastName'],
    );
    expect(w.contactSkips).toEqual(['Seats__c', 'LeadSource']);
  });
});

describe('the card', () => {
  it('sends an unconnected account to Connections instead of showing a mapping', async () => {
    const el = await mount(base(), { connected: false });
    expect(el.querySelector('[data-testid="salesforce-not-connected"] a')?.getAttribute('href')).toBe(
      '/admin/integrations',
    );
    expect(el.querySelector('[data-testid="salesforce-mapping"]')).toBeNull();
  });

  it('shows the Email alert, the placeholders and the Contact skips on screen', async () => {
    const el = await mount(base({ mappings: [{ key: 'seats', field: 'Seats__c' }] }));
    expect(el.querySelector('[data-testid="salesforce-email-missing"]')?.textContent).toBe(
      m.salesforce.emailMissing,
    );
    expect(el.querySelector('[data-testid="salesforce-fallbacks"]')?.textContent).toContain('LastName');
    expect(el.querySelector('[data-testid="salesforce-contact-skips"]')?.textContent).toContain('Seats__c');
  });

  it('says why the fields could not be read', async () => {
    const el = await mount(base(), { fields: { enabled: false, reason: 'rejected' } });
    expect(el.querySelector('[data-testid="salesforce-fields-problem"]')?.textContent).toBe(
      m.salesforce.fieldsRejected,
    );
  });

  it('offers the time zone for a date field and not for a datetime field', async () => {
    let el = await mount(base({ dateField: 'Submitted__c' }));
    expect(el.textContent).toContain(m.salesforce.dayTimezoneLabel);
    act(() => root?.unmount());
    container?.remove();
    el = await mount(base({ dateField: 'Submitted_At__c' }));
    expect(el.textContent).not.toContain(m.salesforce.dayTimezoneLabel);
  });

  it('gives a picklist fixed value a choice of its active values, not a free text box', async () => {
    const el = await mount(base({ statics: [{ field: 'LeadSource', value: '' }] }));
    const row = el.querySelector('[data-testid="salesforce-static"]')!;
    expect(row.querySelector('input')).toBeNull();
    const plain = await (async () => {
      act(() => root?.unmount());
      container?.remove();
      return mount(base({ statics: [{ field: 'Seats__c', value: '' }] }));
    })();
    expect(plain.querySelector('[data-testid="salesforce-static"] input')).not.toBeNull();
  });

  it('re-reads the org on refresh', async () => {
    actions.salesforceFieldsAction.mockResolvedValue({ ok: true, fields: { enabled: false, reason: 'unavailable' } });
    const el = await mount(base());
    const button = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(m.salesforce.refreshFields));
    await act(async () => {
      button!.click();
    });
    expect(actions.salesforceFieldsAction).toHaveBeenCalledWith(true);
    expect(el.querySelector('[data-testid="salesforce-fields-problem"]')?.textContent).toBe(
      m.salesforce.fieldsUnavailable,
    );
  });
});
