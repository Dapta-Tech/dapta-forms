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
import { formDestinationSchema, type FormDestination } from '@quill/types';
import type { SalesforceFieldsResponse } from '@/lib/admin-api';
import type { FormStep } from '@quill/engine';
import { mappableQuestions, type QuestionMeta } from './auto-map';

const actions = vi.hoisted(() => ({ salesforceFieldsAction: vi.fn() }));
vi.mock('./actions', () => actions);

// The connect form is the Integrations page's own, imported from there.
const connectActions = vi.hoisted(() => ({
  connectSalesforceAction: vi.fn(),
  connectIntegrationAction: vi.fn(),
  startGoogleSheetsAuthAction: vi.fn(),
}));
vi.mock('@/app/admin/integrations/actions', () => connectActions);

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/components/toast', () => ({ useToast: () => toasts }));

import type { ConnectAccess } from './connect-in-place';
import {
  builtSalesforce,
  initialSalesforce,
  SalesforceCard,
  salesforceWarnings,
  type SalesforceState,
} from './salesforce-card';

const m = getMessages('en').admin.integrations;
const QUESTIONS: QuestionMeta[] = [
  // Not keyed `email` on purpose: a question with that key is a fallback the
  // delivery uses, which would silence the Email alert these specs check.
  { key: 'work_email', label: 'Work email', type: 'email' },
  { key: 'cv', label: 'Resume', type: 'file' },
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

const cm = getMessages('en').admin.connections;

/** Type into a React-controlled input the way a person does. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function fillSalesforce(el: HTMLElement, values: string[]) {
  const form = el.querySelector('[data-testid="salesforce-connect-form"]')!;
  await act(async () => {
    form.querySelectorAll<HTMLInputElement>('input').forEach((input, i) => type(input, values[i] ?? ''));
  });
  const submit = [...form.querySelectorAll('button')].find((b) => b.textContent === cm.connect)!;
  await act(async () => submit.click());
}

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

async function mount(
  state: SalesforceState,
  opts: {
    connected?: boolean;
    fields?: SalesforceFieldsResponse;
    questions?: QuestionMeta[];
    access?: ConnectAccess;
    locale?: string;
  } = {},
) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <SalesforceCard
        state={state}
        setState={() => {}}
        questions={opts.questions ?? QUESTIONS}
        connected={opts.connected ?? true}
        initialFields={opts.fields ?? FIELDS}
        access={opts.access}
        locale={opts.locale ?? 'en'}
        m={opts.locale === 'es' ? getMessages('es').admin.integrations : m}
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

  it('keeps half-filled rows as drafts, out of what a delivery reads', () => {
    const built = builtSalesforce(
      base({
        mappings: [{ key: 'email', field: 'Email' }, { key: 'last', field: '' }, { key: '', field: 'Company' }],
        statics: [{ field: 'LeadSource', value: '' }, { field: '', value: '' }],
      }),
    );
    expect(built).toEqual({
      type: 'salesforce',
      enabled: true,
      fieldMappings: { email: 'Email' },
      utmMappings: {},
      drafts: {
        mappings: [{ key: 'last', field: '' }, { key: '', field: 'Company' }],
        // A row with nothing in it at all is nothing to keep.
        statics: [{ field: 'LeadSource', value: '' }],
      },
    });
  });

  it('brings every half-filled row back after a reload, saying what it needs', async () => {
    const state = base({
      mappings: [{ key: 'email', field: 'Email' }, { key: 'last', field: '' }],
      statics: [{ field: 'LeadSource', value: '' }],
    });
    // A reload: the stored destination, parsed by the API's own schema.
    const stored = formDestinationSchema.parse(JSON.parse(JSON.stringify(builtSalesforce(state))));
    expect(initialSalesforce([stored as FormDestination])).toEqual(state);
    const el = await mount(initialSalesforce([stored as FormDestination]));
    const hints = [...el.querySelectorAll('[data-testid="row-incomplete"]')].map((h) => h.textContent);
    expect(hints).toEqual([m.salesforce.rowNeedsField, m.salesforce.rowNeedsValue]);
  });

  it('delivers exactly as before for a config stored with no drafts', () => {
    const legacy = formDestinationSchema.parse({
      type: 'salesforce',
      enabled: true,
      fieldMappings: { email: 'Email' },
      utmMappings: {},
    });
    expect(legacy).not.toHaveProperty('drafts');
    expect(builtSalesforce(initialSalesforce([legacy as FormDestination]))).toEqual({
      type: 'salesforce',
      enabled: true,
      fieldMappings: { email: 'Email' },
      utmMappings: {},
    });
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

  it('does not flag Email when the form has a question keyed `email`, which a delivery falls back to', () => {
    expect(salesforceWarnings(base(), [], true).emailMissing).toBe(false);
  });

  it('names the required Lead fields a new Lead will get placeholders for', () => {
    const w = salesforceWarnings(base({ mappings: [{ key: 'last', field: 'LastName' }] }), []);
    expect(w.fallbacks).toEqual(['Company']);
  });

  it('names an org-required Lead field nothing fills, which no fallback covers', () => {
    const lead = [
      ...(FIELDS.enabled ? FIELDS.lead : []),
      { name: 'Region__c', label: 'Region', type: 'picklist', required: true },
    ];
    const w = salesforceWarnings(base({ mappings: [{ key: 'work_email', field: 'Email' }] }), [], false, lead);
    // LastName and Company are filled by the delivery; Region is not.
    expect(w.unfilledRequired).toEqual(['Region']);
    const mapped = salesforceWarnings(
      base({ statics: [{ field: 'Region__c', value: 'LATAM' }] }),
      [],
      false,
      lead,
    );
    expect(mapped.unfilledRequired).toEqual([]);
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
  it('connects in place instead of sending the author to another page', async () => {
    const el = await mount(base(), { connected: false });
    const prompt = el.querySelector('[data-testid="salesforce-not-connected"]')!;
    expect(prompt.textContent).toContain(m.salesforce.connectTitle);
    // The Integrations page's own three-field form, setup steps included.
    expect(prompt.querySelector('[data-testid="salesforce-connect-form"]')).not.toBeNull();
    expect(prompt.textContent).toContain(cm.salesforceSetupTitle);
    expect([...prompt.querySelectorAll('input')].map((i) => i.type)).toEqual(['text', 'text', 'password']);
    // There is no token here: the sentence names the key and secret.
    expect(prompt.textContent).toContain(cm.salesforceSecretHelp);
    expect(prompt.textContent).not.toContain(cm.tokenHelp);
    expect(prompt.querySelector('a[href="/admin/integrations"]')).toBeNull();
    expect(el.querySelector('[data-testid="salesforce-mapping"]')).toBeNull();
  });

  it('says why a refused connect failed, in the Integrations page’s own words', async () => {
    connectActions.connectSalesforceAction.mockResolvedValueOnce({ ok: false, reason: 'domain_invalid' });
    const el = await mount(base(), { connected: false });
    await fillSalesforce(el, ['not a domain', 'KEY', 'SECRET']);
    expect(el.querySelector('[data-testid="salesforce-connect-problem"]')?.textContent).toBe(
      cm.salesforceErrors.domain_invalid,
    );
    expect(el.querySelector('[data-testid="salesforce-mapping"]')).toBeNull();
  });

  it('switches to the mapping and loads the org’s fields once connected', async () => {
    connectActions.connectSalesforceAction.mockResolvedValueOnce({
      ok: true,
      status: { provider: 'salesforce', connected: true, last4: '1234', label: 'Acme', connectedAt: 1 },
    });
    actions.salesforceFieldsAction.mockResolvedValueOnce({ ok: true, fields: FIELDS });
    const el = await mount(base(), {
      connected: false,
      fields: { enabled: false, reason: 'not_connected' },
    });
    await fillSalesforce(el, ['acme.my.salesforce.com', 'KEY', 'SECRET']);
    expect(el.querySelector('[data-testid="salesforce-mapping"]')).not.toBeNull();
    expect(actions.salesforceFieldsAction).toHaveBeenCalledWith(true);
    expect(toasts.success).toHaveBeenCalled();
  });

  it('tells a plain member an admin has to connect it, with no form to fill', async () => {
    const el = await mount(base(), {
      connected: false,
      access: { canConnect: false, encryptionAvailable: true },
    });
    const prompt = el.querySelector('[data-testid="salesforce-not-connected"]')!;
    expect(prompt.querySelector('[data-testid="connect-admin-only"]')?.textContent).toContain('Salesforce');
    expect(prompt.querySelector('input')).toBeNull();
    expect(prompt.querySelector('button')).toBeNull();
  });

  it('speaks Spanish with tú, and names Integraciones', async () => {
    const el = await mount(base(), {
      connected: false,
      access: { canConnect: false, encryptionAvailable: true },
      locale: 'es',
    });
    const text = el.querySelector('[data-testid="salesforce-not-connected"]')!.textContent!;
    expect(text).toContain('Integraciones');
    expect(text).not.toMatch(/Conexiones|Conectá/);
  });

  it('shows the Email alert, the placeholders and the Contact skips on screen', async () => {
    const el = await mount(base({ mappings: [{ key: 'seats', field: 'Seats__c' }] }));
    expect(el.querySelector('[data-testid="salesforce-email-missing"]')?.textContent).toBe(
      m.salesforce.emailMissing,
    );
    expect(el.querySelector('[data-testid="salesforce-fallbacks"]')?.textContent).toContain('LastName');
    expect(el.querySelector('[data-testid="salesforce-contact-skips"]')?.textContent).toContain('Seats__c');
  });

  it('drops the Email alert when the form has a question keyed `email`', async () => {
    const el = await mount(base(), { questions: [...QUESTIONS, { key: 'email', label: 'Email', type: 'email' }] });
    expect(el.querySelector('[data-testid="salesforce-email-missing"]')).toBeNull();
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

  // The trigger of row `i`'s question picker, and the options it opens.
  async function questionOptionsOf(el: HTMLElement, i = 0): Promise<{ trigger: HTMLButtonElement; options: string[] }> {
    const row = el.querySelectorAll('[data-testid="salesforce-row"]')[i]!;
    const trigger = row.querySelector<HTMLButtonElement>(`button[aria-label="${m.salesforce.questionPlaceholder}"]`)!;
    await act(async () => trigger.click());
    const options = [...row.querySelectorAll('[role="option"]')].map((o) => o.textContent ?? '');
    return { trigger, options };
  }

  it('offers a name question as its first and last name, the keys its answer is stored under', async () => {
    const questions = mappableQuestions(
      [{ key: 'full_name', type: 'name', question: 'Nombre y Apellido' } as FormStep],
      { first: 'Nombre', last: 'Apellido' },
    );
    const el = await mount(base({ mappings: [{ key: '', field: 'LastName' }] }), { questions });
    const { options } = await questionOptionsOf(el);
    expect(options).toEqual(['Nombre y Apellido · Nombre', 'Nombre y Apellido · Apellido']);
  });

  it('still shows a stored key the form no longer offers, as itself', async () => {
    // Saved before a name question was offered as its two answers: the row
    // must keep reading what is stored, not fall back to the placeholder.
    const questions = mappableQuestions(
      [{ key: 'full_name', type: 'name', question: 'Nombre y Apellido' } as FormStep],
      { first: 'Nombre', last: 'Apellido' },
    );
    const el = await mount(base({ mappings: [{ key: 'full_name', field: 'LastName' }] }), { questions });
    const { trigger, options } = await questionOptionsOf(el);
    expect(trigger.textContent).toBe('full_name');
    expect(options).toEqual(['full_name', 'Nombre y Apellido · Nombre', 'Nombre y Apellido · Apellido']);
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
