// @vitest-environment happy-dom
/**
 * The HighLevel card, from the author's side, and the state it saves.
 *
 * Pinned here: a stored destination round-trips exactly (opening the tab must
 * never rewrite a config nobody touched, `events` included), the mapping is
 * shown in a Standard and a Custom fields group, only a custom field whose
 * type can take the answer is offered, switching the card on proposes the
 * mapping, and the card says what a delivery would otherwise only reveal in
 * HighLevel: no Email or Phone mapped, and who decides about duplicates.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getMessages } from '@quill/shared';
import { formDestinationSchema, type FormDestination, type GoHighLevelFieldsResponse } from '@quill/types';
import type { QuestionMeta } from './auto-map';

const actions = vi.hoisted(() => ({ goHighLevelFieldsAction: vi.fn() }));
vi.mock('./actions', () => actions);

// The connect form is the Integrations page's own, imported from there.
const connectActions = vi.hoisted(() => ({
  connectGoHighLevelAction: vi.fn(),
  connectSalesforceAction: vi.fn(),
  connectIntegrationAction: vi.fn(),
  startGoogleSheetsAuthAction: vi.fn(),
}));
vi.mock('@/app/admin/integrations/actions', () => connectActions);

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/components/toast', () => ({ useToast: () => toasts }));

import type { ConnectAccess } from './connect-in-place';
import { carriedOthers } from './integrations-editor';
import {
  builtGoHighLevel,
  customFieldSuits,
  EMPTY_GOHIGHLEVEL,
  GoHighLevelCard,
  goHighLevelAutoMap,
  goHighLevelIdentityMissing,
  initialGoHighLevel,
  normalizeTag,
  type GoHighLevelState,
} from './gohighlevel-card';

const m = getMessages('en').admin.integrations;
const hm = m.highlevel;
const cm = getMessages('en').admin.connections;

const QUESTIONS: QuestionMeta[] = [
  { key: 'work_email', label: 'Work email', type: 'email' },
  { key: 'mobile', label: 'Mobile', type: 'phone' },
  { key: 'firstname', label: 'Your name · First name', type: 'name', namePart: 'first' },
  { key: 'lastname', label: 'Your name · Last name', type: 'name', namePart: 'last' },
  { key: 'company', label: 'Company name', type: 'text' },
  { key: 'seats', label: 'Seats', type: 'slider' },
  { key: 'channels', label: 'Channels', type: 'multiple_choice' },
  { key: 'cv', label: 'Resume', type: 'file' },
];

const cf = (id: string, key: string, dataType: string, options?: string[]) => ({
  kind: 'custom' as const,
  id,
  key: `contact.${key}`,
  name: key,
  dataType: dataType as 'TEXT',
  ...(options ? { options } : {}),
});
const CUSTOM = [
  cf('cf-text', 'qa_text', 'TEXT'),
  cf('cf-number', 'qa_number', 'NUMERICAL'),
  cf('cf-money', 'qa_money', 'MONETORY'),
  cf('cf-date', 'qa_date', 'DATE'),
  cf('cf-multi', 'qa_multi', 'MULTIPLE_OPTIONS', ['Email', 'SMS', 'Call']),
  cf('cf-single', 'qa_single', 'SINGLE_OPTIONS', ['Basic', 'Pro']),
  cf('cf-utm-source', 'utm_source', 'TEXT'),
  cf('cf-utm-campaign', 'utm_campaign', 'LARGE_TEXT'),
];
const FIELDS: GoHighLevelFieldsResponse = { enabled: true, cached: false, standard: [], custom: CUSTOM };
const target = (f: (typeof CUSTOM)[number]) => ({ kind: 'custom' as const, id: f.id, key: f.key, dataType: f.dataType });
const byId = (id: string) => target(CUSTOM.find((f) => f.id === id)!);

const base = (over: Partial<GoHighLevelState> = {}): GoHighLevelState => ({
  ...EMPTY_GOHIGHLEVEL,
  enabled: true,
  ...over,
});

let root: Root | null = null;
let container: HTMLElement | null = null;
/** The card's state as the last edit left it (the harness owns it). */
let latest: GoHighLevelState | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  latest = null;
  vi.clearAllMocks();
});

function Harness(props: {
  initial: GoHighLevelState;
  connected: boolean;
  rejected: boolean;
  fields: GoHighLevelFieldsResponse;
  questions: QuestionMeta[];
  access?: ConnectAccess;
  partialsHeld: boolean;
  locale: string;
}) {
  const [state, setState] = useState(props.initial);
  return (
    <GoHighLevelCard
      state={state}
      setState={(next) => {
        latest = next;
        setState(next);
      }}
      questions={props.questions}
      connected={props.connected}
      rejected={props.rejected}
      initialFields={props.fields}
      access={props.access}
      formName="Demo"
      partialsHeld={props.partialsHeld}
      locale={props.locale}
      m={props.locale === 'es' ? getMessages('es').admin.integrations : m}
    />
  );
}

async function mount(
  state: GoHighLevelState,
  opts: {
    connected?: boolean;
    rejected?: boolean;
    fields?: GoHighLevelFieldsResponse;
    questions?: QuestionMeta[];
    access?: ConnectAccess;
    partialsHeld?: boolean;
    locale?: string;
  } = {},
) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <Harness
        initial={state}
        connected={opts.connected ?? true}
        rejected={opts.rejected ?? false}
        fields={opts.fields ?? FIELDS}
        questions={opts.questions ?? QUESTIONS}
        access={opts.access}
        partialsHeld={opts.partialsHeld ?? false}
        locale={opts.locale ?? 'en'}
      />,
    );
  });
  return container;
}

/** Type into a React-controlled input the way a person does. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Open a picker by its label inside `scope` and read the options it offers. */
async function optionsOf(scope: Element, label: string): Promise<string[]> {
  const trigger = scope.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  await act(async () => trigger.click());
  const options = [...scope.querySelectorAll('[role="option"]')].map((o) => o.textContent ?? '');
  await act(async () => trigger.click());
  return options;
}

const button = (scope: Element, text: string) =>
  [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

describe('stored state', () => {
  const FULL = formDestinationSchema.parse({
    type: 'gohighlevel',
    enabled: true,
    events: ['partial', 'complete'],
    fieldMappings: {
      work_email: [{ kind: 'standard', field: 'email' }],
      // A custom target stored BEFORE a standard one: kept in that order.
      company: [byId('cf-text'), { kind: 'standard', field: 'companyName' }],
    },
    utmMappings: { utm_source: byId('cf-utm-source') },
    scoreField: byId('cf-number'),
    dateField: byId('cf-date'),
    dayTimezone: 'America/Bogota',
    staticFields: [{ target: { kind: 'standard', field: 'country' }, value: 'CO' }],
    tags: ['Webinar', 'lead'],
    source: 'Landing',
    drafts: { mappings: [{ key: 'mobile', target: null }] },
  }) as FormDestination;

  it('round-trips a stored destination exactly, order, casing and drafts included', () => {
    expect(builtGoHighLevel(initialGoHighLevel([FULL]))).toEqual(FULL);
  });

  it('leaves `events` absent on a config that never had it, so its default stays the default', () => {
    const legacy = formDestinationSchema.parse({
      type: 'gohighlevel',
      enabled: true,
      fieldMappings: { work_email: [{ kind: 'standard', field: 'email' }] },
    }) as FormDestination;
    const built = builtGoHighLevel(initialGoHighLevel([legacy]));
    expect(built).toEqual(legacy);
    expect(built).not.toHaveProperty('events');
  });

  it('stores nothing for an untouched, switched-off card', () => {
    expect(builtGoHighLevel(initialGoHighLevel([]))).toBeNull();
  });

  it('keeps half-filled rows as drafts, out of what a delivery reads', () => {
    const built = builtGoHighLevel(
      base({
        mappings: [
          { key: 'work_email', kind: 'standard', target: { kind: 'standard', field: 'email' } },
          { key: 'seats', kind: 'custom', target: null },
          { key: '', kind: 'standard', target: null },
        ],
        statics: [{ target: byId('cf-text'), value: '' }],
      }),
    );
    expect(built).toEqual({
      type: 'gohighlevel',
      enabled: true,
      fieldMappings: { work_email: [{ kind: 'standard', field: 'email' }] },
      utmMappings: {},
      drafts: { mappings: [{ key: 'seats', target: null }], statics: [{ target: byId('cf-text'), value: '' }] },
    });
    // What the API stores parses back.
    expect(formDestinationSchema.safeParse(built).success).toBe(true);
  });

  it('is no longer carried untouched by the editor, which now builds it', () => {
    expect(carriedOthers([FULL])).toEqual([]);
  });
});

describe('which field a question may fill', () => {
  it.each([
    ['slider', 'NUMERICAL', true],
    ['slider', 'DATE', false],
    ['text', 'DATE', true],
    ['multiple_choice', 'MULTIPLE_OPTIONS', true],
    ['email', 'MULTIPLE_OPTIONS', false],
    ['phone', 'PHONE', true],
    ['email', 'PHONE', false],
    ['email', 'TEXT', true],
    ['file', 'TEXT', false],
    // A consent box's `true` is no choice of an options field.
    ['checkbox', 'CHECKBOX', false],
    ['checkbox', 'TEXT', true],
    // Types the upsert cannot take are never offered, whatever the question.
    ['text', 'TEXTBOX_LIST', false],
    ['text', 'FILE_UPLOAD', false],
    ['text', 'FLOAT', false],
  ])('a %s answer into a %s custom field: %s', (questionType, dataType, ok) => {
    expect(customFieldSuits(questionType, dataType)).toBe(ok);
  });

  it('keeps a multiple-mode choice out of a single-choice field, and lets it into a multi one', () => {
    expect(customFieldSuits('multiple_choice', 'SINGLE_OPTIONS')).toBe(true);
    expect(customFieldSuits('multiple_choice', 'SINGLE_OPTIONS', true)).toBe(false);
    expect(customFieldSuits('multiple_choice', 'RADIO', true)).toBe(false);
    expect(customFieldSuits('multiple_choice', 'MULTIPLE_OPTIONS', true)).toBe(true);
    expect(customFieldSuits('multiple_choice', 'TEXT', true)).toBe(true);
  });
});

describe('auto-map', () => {
  it('proposes email, phone, name and company, and the utm_* custom fields the sub-account has', () => {
    const { mappings, utm } = goHighLevelAutoMap(QUESTIONS, CUSTOM);
    expect(mappings.map((r) => [r.key, r.target])).toEqual([
      ['work_email', { kind: 'standard', field: 'email' }],
      ['mobile', { kind: 'standard', field: 'phone' }],
      ['firstname', { kind: 'standard', field: 'firstName' }],
      ['lastname', { kind: 'standard', field: 'lastName' }],
      ['company', { kind: 'standard', field: 'companyName' }],
    ]);
    expect(utm).toEqual({ utm_source: byId('cf-utm-source'), utm_campaign: byId('cf-utm-campaign') });
  });

  it('never proposes a utm_* field whose type cannot take text', () => {
    const { utm } = goHighLevelAutoMap([], [cf('n', 'utm_term', 'NUMERICAL')]);
    expect(utm).toEqual({});
  });

  it('fills the card when it is switched on for the first time, and not again', async () => {
    const el = await mount({ ...EMPTY_GOHIGHLEVEL });
    const toggle = el.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${hm.title}"]`)!;
    await act(async () => toggle.click());
    expect(latest?.enabled).toBe(true);
    expect(latest?.mappings).toHaveLength(5);
    expect(latest?.utm.utm_source).toEqual(byId('cf-utm-source'));
    // Off and on again: what the author has is kept, nothing is re-proposed.
    await act(async () => toggle.click());
    await act(async () => toggle.click());
    expect(latest?.mappings).toHaveLength(5);
  });
});

describe('the card', () => {
  it('groups the mapping into Standard and Custom fields, each with its own picker', async () => {
    const el = await mount(
      base({
        mappings: [
          { key: 'seats', kind: 'custom', target: byId('cf-number') },
          { key: 'work_email', kind: 'standard', target: { kind: 'standard', field: 'email' } },
        ],
      }),
    );
    const standard = el.querySelector('[data-testid="highlevel-group-standard"]')!;
    const custom = el.querySelector('[data-testid="highlevel-group-custom"]')!;
    expect(standard.textContent).toContain(hm.standardGroup);
    expect(custom.textContent).toContain(hm.customGroup);
    expect(standard.querySelectorAll('[data-testid="highlevel-row-standard"]')).toHaveLength(1);
    expect(custom.querySelectorAll('[data-testid="highlevel-row-custom"]')).toHaveLength(1);
    expect(standard.textContent).toContain(hm.standardFields.email);
    expect(custom.textContent).toContain('qa_number (contact.qa_number)');
  });

  it('offers only the custom fields whose type can take the question’s answer', async () => {
    const el = await mount(base({ mappings: [{ key: 'seats', kind: 'custom', target: null }] }));
    const row = el.querySelector('[data-testid="highlevel-row-custom"]')!;
    const options = await optionsOf(row, hm.customFieldPlaceholder);
    expect(options).toEqual(
      expect.arrayContaining(['qa_text (contact.qa_text)', 'qa_number (contact.qa_number)', 'qa_money (contact.qa_money)']),
    );
    expect(options).not.toContain('qa_date (contact.qa_date)');
    expect(options).not.toContain('qa_multi (contact.qa_multi)');
  });

  it('offers only the standard fields a question type can fill', async () => {
    const el = await mount(base({ mappings: [{ key: 'work_email', kind: 'standard', target: null }] }));
    const options = await optionsOf(el.querySelector('[data-testid="highlevel-row-standard"]')!, hm.fieldPlaceholder);
    expect(options).toEqual([hm.standardFields.email]);
  });

  it('offers only number fields for the score, date fields for the date, and text fields for a UTM', async () => {
    const el = await mount(base());
    expect(await optionsOf(el, hm.scoreLabel)).toEqual([hm.none, 'qa_number (contact.qa_number)']);
    expect(await optionsOf(el, hm.dateLabel)).toEqual([hm.none, 'qa_date (contact.qa_date)']);
    const utm = await optionsOf(el, 'utm_medium');
    expect(utm).toContain('qa_text (contact.qa_text)');
    expect(utm).not.toContain('qa_number (contact.qa_number)');
  });

  it('flags a stored target whose type no longer fits the answer, without changing it', async () => {
    const el = await mount(base({ mappings: [{ key: 'work_email', kind: 'custom', target: byId('cf-date') }] }));
    expect(el.querySelector('[data-testid="row-incomplete"]')?.textContent).toBe(hm.rowIncompatible);
    expect(el.querySelector('[data-testid="highlevel-row-custom"]')?.textContent).toContain('qa_date');
  });

  it('warns when neither Email nor Phone is mapped, and stops warning once one is', async () => {
    const el = await mount(base({ mappings: [{ key: 'company', kind: 'standard', target: { kind: 'standard', field: 'companyName' } }] }));
    expect(el.querySelector('[data-testid="highlevel-identity-missing"]')?.textContent).toBe(hm.emailPhoneMissing);
    expect(
      goHighLevelIdentityMissing(base({ mappings: [{ key: 'mobile', kind: 'standard', target: { kind: 'standard', field: 'phone' } }] })),
    ).toBe(false);
  });

  it('does not warn when a question keyed `email` is there, since the delivery falls back to it', () => {
    const state = base({ mappings: [{ key: 'company', kind: 'standard', target: { kind: 'standard', field: 'companyName' } }] });
    expect(goHighLevelIdentityMissing(state, [{ key: 'company' }])).toBe(true);
    expect(goHighLevelIdentityMissing(state, [{ key: 'company' }, { key: 'email' }])).toBe(false);
  });

  it('says who decides about duplicates, and the shared-phone trap', async () => {
    const el = await mount(base());
    expect(el.querySelector('[data-testid="highlevel-duplicates"]')?.textContent).toBe(hm.duplicates);
    expect(hm.duplicates).toMatch(/Contact Duplication Preferences/);
    expect(hm.duplicates).toMatch(/share a number/);
  });

  it('adds tags as lowercase chips, once each, and removes them', async () => {
    const el = await mount(base());
    const input = el.querySelector<HTMLInputElement>('[data-testid="highlevel-tag-input"]')!;
    const enter = () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await act(async () => type(input, '  Webinar Nov '));
    await act(async () => enter());
    await act(async () => type(input, 'WEBINAR NOV'));
    await act(async () => enter());
    expect(latest?.tags).toEqual(['webinar nov']);
    expect(el.querySelector('[data-testid="highlevel-tags"]')?.textContent).toContain('webinar nov');
    expect(hm.tagsHint).toMatch(/never removed/);
    const remove = el.querySelector<HTMLButtonElement>(`button[aria-label="${hm.removeTag.replace('{tag}', 'webinar nov')}"]`)!;
    await act(async () => remove.click());
    expect(latest?.tags).toEqual([]);
    expect(normalizeTag('   ')).toBeNull();
  });

  it('never offers Email or Phone for a fixed value, and says a stored one is ignored', async () => {
    const el = await mount(base({ statics: [{ target: null, value: '' }] }));
    const options = await optionsOf(el.querySelector('[data-testid="highlevel-static"]')!, hm.fieldPlaceholder);
    expect(options).toContain(hm.standardFields.country);
    expect(options).toContain('qa_single (contact.qa_single)');
    expect(options).not.toContain(hm.standardFields.email);
    expect(options).not.toContain(hm.standardFields.phone);
    act(() => root?.unmount());
    container?.remove();
    const legacy = await mount(base({ statics: [{ target: { kind: 'standard', field: 'email' }, value: 'x@y.co' }] }));
    expect(legacy.querySelector('[data-testid="row-incomplete"]')?.textContent).toBe(hm.staticIdentityIgnored);
  });

  it('gives an option field’s fixed value its choices, not a text box', async () => {
    const el = await mount(base({ statics: [{ target: byId('cf-single'), value: '' }] }));
    const row = el.querySelector('[data-testid="highlevel-static"]')!;
    expect(row.querySelector('input')).toBeNull();
    expect(await optionsOf(row, hm.valuePlaceholder)).toEqual(['Basic', 'Pro']);
  });

  it('shows the default source the contact gets when it is blank', async () => {
    const el = await mount(base());
    expect(el.querySelector<HTMLInputElement>('[data-testid="highlevel-source"]')?.placeholder).toBe('dForms: Demo');
    expect(el.textContent).toContain('Blank sends “dForms: Demo”');
  });

  it('starts with partials off, writes `events` only when the switch is touched, and says when they are held', async () => {
    const el = await mount(base(), { partialsHeld: true });
    const sw = el.querySelector<HTMLButtonElement>('[data-testid="highlevel-partials-switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(el.querySelector('[data-testid="highlevel-partials-held"]')).toBeNull();
    await act(async () => sw.click());
    expect(latest?.events).toEqual(['partial', 'complete']);
    expect(el.querySelector('[data-testid="highlevel-partials-held"]')?.textContent).toBe(m.eventPartialHeld);
    await act(async () => sw.click());
    expect(latest?.events).toEqual(['complete']);
  });

  it('connects in place, with a link to Integrations, when HighLevel is not connected', async () => {
    const el = await mount(base(), { connected: false, fields: { enabled: false, reason: 'not_connected' } });
    const prompt = el.querySelector('[data-testid="highlevel-not-connected"]')!;
    expect(prompt.textContent).toContain(hm.connectTitle);
    expect(prompt.querySelector('[data-testid="highlevel-connect-form"]')).not.toBeNull();
    expect(el.querySelector('a[href="/admin/integrations"]')?.textContent).toContain(hm.openConnections);
    expect(el.querySelector('[data-testid="highlevel-mapping"]')).toBeNull();
  });

  it('switches to the mapping and reads the fields once connected in place', async () => {
    connectActions.connectGoHighLevelAction.mockResolvedValueOnce({
      ok: true,
      status: { provider: 'gohighlevel', connected: true, last4: 'abcd', label: 'Acme', connectedAt: 1 },
    });
    actions.goHighLevelFieldsAction.mockResolvedValueOnce({ ok: true, fields: FIELDS });
    const el = await mount(base(), { connected: false, fields: { enabled: false, reason: 'not_connected' } });
    const inputs = el.querySelectorAll<HTMLInputElement>('[data-testid="highlevel-connect-form"] input');
    await act(async () => {
      type(inputs[0]!, 'pit-1234');
      type(inputs[1]!, 'loc-1');
    });
    await act(async () => button(el.querySelector('[data-testid="highlevel-connect-form"]')!, cm.connect).click());
    expect(connectActions.connectGoHighLevelAction).toHaveBeenCalledWith({ token: 'pit-1234', locationId: 'loc-1' });
    expect(el.querySelector('[data-testid="highlevel-mapping"]')).not.toBeNull();
    expect(actions.goHighLevelFieldsAction).toHaveBeenCalledWith(true);
  });

  it('tells a plain member an admin has to connect it, with no form to fill', async () => {
    const el = await mount(base(), { connected: false, access: { canConnect: false, encryptionAvailable: true } });
    const prompt = el.querySelector('[data-testid="highlevel-not-connected"]')!;
    expect(prompt.querySelector('[data-testid="connect-admin-only"]')?.textContent).toContain('HighLevel');
    expect(prompt.querySelector('input')).toBeNull();
  });

  it('says HighLevel stopped accepting the token, from the connection or from the fields route', async () => {
    let el = await mount(base(), { rejected: true });
    expect(el.querySelector('[data-testid="highlevel-rejected"]')?.textContent).toContain(hm.rejected);
    act(() => root?.unmount());
    container?.remove();
    el = await mount(base(), { fields: { enabled: false, reason: 'rejected' } });
    expect(el.querySelector('[data-testid="highlevel-rejected"] a')?.getAttribute('href')).toBe('/admin/integrations');
  });

  it('re-reads the location on refresh, and says when custom fields cannot be listed', async () => {
    actions.goHighLevelFieldsAction.mockResolvedValue({
      ok: true,
      fields: { enabled: true, cached: false, standard: [], custom: [], warning: 'custom_fields_unavailable' },
    });
    const el = await mount(base());
    await act(async () => button(el, hm.refreshFields).click());
    expect(actions.goHighLevelFieldsAction).toHaveBeenCalledWith(true);
    expect(el.querySelector('[data-testid="highlevel-fields-problem"]')?.textContent).toBe(hm.fieldsUnavailable);
  });

  it('speaks Spanish with tú, says subcuenta, and never voseo', async () => {
    const es = getMessages('es').admin.integrations.highlevel;
    const all = JSON.stringify(es) + JSON.stringify(getMessages('es').admin.connections.highlevel);
    expect(all).toMatch(/subcuenta/);
    expect(all).not.toMatch(/(?<!\p{L})(querés|podés|tenés|elegí|conectá|pegá|copiá|creá|vos)(?!\p{L})/iu);
    expect(all).not.toMatch(/[–—]/);
    const el = await mount(base(), { locale: 'es' });
    expect(el.textContent).toContain(es.standardGroup);
  });
});
