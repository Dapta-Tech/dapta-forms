// @vitest-environment happy-dom
/**
 * The "send partial responses too" switch on the HubSpot and Salesforce cards.
 *
 *  - Its starting position is the phase rule the API delivers with: on for a
 *    HubSpot config with no `events` (both phases, as before the switch
 *    existed), off for a Salesforce one (complete only).
 *  - Opening the tab and editing something else never writes `events`: a
 *    legacy config keeps meaning exactly what it meant.
 *  - A flip writes `events` explicitly: both phases on, complete only off.
 *  - Salesforce with partials on says a partial can create a Lead with
 *    "[not provided]"; with spam protection holding partials, both cards say
 *    nothing partial is sent meanwhile.
 *  - The Google Sheets card says it only ever gets complete responses.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getMessages } from '@quill/shared';
import type { ContactKeyReadiness } from '@quill/engine';
import type { FormDestination } from '@quill/types';

const actions = vi.hoisted(() => ({
  saveIntegrationsAction: vi.fn(),
  pingWebhookAction: vi.fn(),
  hubspotPropertiesAction: vi.fn(),
  loadDeliveryHistoryAction: vi.fn(async () => []),
  googleSheetsCreateAction: vi.fn(),
  googleSheetsPickerAction: vi.fn(),
  googleSheetsTabsAction: vi.fn(async () => ({ ok: true, data: { enabled: true, spreadsheetTitle: 'S', tabs: [] } })),
  syncSheetHeadersAction: vi.fn(async () => ({ ok: true, data: { ok: true, outcome: 'unchanged' } })),
  salesforceFieldsAction: vi.fn(),
}));
vi.mock('./actions', () => actions);
vi.mock('@/app/admin/integrations/actions', () => ({
  connectIntegrationAction: vi.fn(),
  connectSalesforceAction: vi.fn(),
  startGoogleSheetsAuthAction: vi.fn(),
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() }));
vi.mock('@/components/toast', () => ({ useToast: () => toasts }));

import { IntegrationsEditor } from './integrations-editor';
import { resetIntegrationsSaveQueues } from '@/lib/integrations-save-queue';

const ready = { ok: true, blocker: null, source: { kind: 'question', key: 'email' } } as ContactKeyReadiness;

let root: Root | null = null;
let container: HTMLElement | null = null;
let written: FormDestination[][] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  vi.useFakeTimers();
  written = [];
  actions.saveIntegrationsAction.mockImplementation(async (_id: string, d: FormDestination[]) => {
    written.push(d);
    return { ok: true };
  });
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  resetIntegrationsSaveQueues();
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function mount(
  initialDestinations: FormDestination[],
  extra: { partialsHeld?: boolean; locale?: 'en' | 'es'; googleSheetsConnected?: boolean } = {},
) {
  const locale = extra.locale ?? 'en';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <IntegrationsEditor
        id="form-crm"
        initialDestinations={initialDestinations}
        hubspot={{ enabled: true, cached: true, properties: [] }}
        hubspotConnected
        salesforceConnected
        salesforceFields={{ enabled: true, cached: true, lead: [], contact: [] }}
        googleSheetsConnected={extra.googleSheetsConnected ?? false}
        readiness={ready}
        questions={[{ key: 'email', label: 'Email', type: 'email' }]}
        partialsHeld={extra.partialsHeld}
        messages={getMessages(locale).admin.integrations}
        locale={locale}
      />,
    );
  });
  return container;
}

const m = getMessages('en').admin.integrations;
const q = <T extends Element = HTMLElement>(el: HTMLElement, testId: string) =>
  el.querySelector<T & HTMLElement>(`[data-testid="${testId}"]`);
const partialsSwitch = (el: HTMLElement, card: 'hubspot' | 'salesforce') =>
  q<HTMLButtonElement>(el, `${card}-partials-switch`)!;
const isOn = (button: HTMLButtonElement) => button.getAttribute('aria-checked') === 'true';
const switchNamed = (el: HTMLElement, label: string) =>
  el.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${label}"]`)!;

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
}
const lastSaved = (type: string) =>
  written.at(-1)!.find((d) => d.type === type) as (FormDestination & { events?: string[] }) | undefined;

const hubspot = (over: Record<string, unknown> = {}): FormDestination =>
  ({ type: 'hubspot', enabled: true, settings: { note: true }, fieldMappings: { email: 'email' }, ...over }) as unknown as FormDestination;
const salesforce = (over: Record<string, unknown> = {}): FormDestination =>
  ({ type: 'salesforce', enabled: true, fieldMappings: { email: 'Email' }, utmMappings: {}, ...over }) as unknown as FormDestination;

describe('HubSpot: send partial responses too', () => {
  it('starts on for a config with no events, and an unrelated edit saves no events', async () => {
    const el = await mount([hubspot()]);
    expect(isOn(partialsSwitch(el, 'hubspot'))).toBe(true);
    // Opening the tab saved nothing at all.
    await settle();
    expect(written).toHaveLength(0);
    // Another switch on the same card: the destination is rebuilt and saved.
    await act(async () => switchNamed(el, m.createNote).click());
    await settle();
    expect((lastSaved('hubspot') as { settings?: unknown } | undefined)?.settings).toMatchObject({ note: false });
    expect(lastSaved('hubspot')).not.toHaveProperty('events');
  });

  it('writes explicit events when flipped: complete only off, both on', async () => {
    const el = await mount([hubspot()]);
    await act(async () => partialsSwitch(el, 'hubspot').click());
    await settle();
    expect(isOn(partialsSwitch(el, 'hubspot'))).toBe(false);
    expect(lastSaved('hubspot')?.events).toEqual(['complete']);
    await act(async () => partialsSwitch(el, 'hubspot').click());
    await settle();
    expect(lastSaved('hubspot')?.events).toEqual(['partial', 'complete']);
  });

  it('reads stored events as written and saves them back unchanged', async () => {
    const el = await mount([hubspot({ events: ['complete'] })]);
    expect(isOn(partialsSwitch(el, 'hubspot'))).toBe(false);
    await act(async () => switchNamed(el, m.createNote).click());
    await settle();
    expect(lastSaved('hubspot')?.events).toEqual(['complete']);
  });

  it('marks the switch paused while spam protection holds partials, beside the existing note', async () => {
    const el = await mount([hubspot()], { partialsHeld: true });
    expect(q(el, 'hubspot-partials-held')?.textContent).toBe(m.eventPartialHeld);
    expect(q(el, 'hubspot-partial-held')?.textContent).toBe(m.hubspotPartialHeld);
    // Off: nothing partial to hold, so no badge.
    await act(async () => partialsSwitch(el, 'hubspot').click());
    expect(q(el, 'hubspot-partials-held')).toBeNull();
  });

  it('says nothing about holding when protection is off', async () => {
    const el = await mount([hubspot()]);
    expect(isOn(partialsSwitch(el, 'hubspot'))).toBe(true);
    expect(q(el, 'hubspot-partials-held')).toBeNull();
  });
});

describe('Salesforce: send partial responses too', () => {
  it('starts off for a config with no events, and an unrelated edit saves no events', async () => {
    const el = await mount([salesforce()]);
    expect(isOn(partialsSwitch(el, 'salesforce'))).toBe(false);
    expect(q(el, 'salesforce-partials-warning')).toBeNull();
    await settle();
    expect(written).toHaveLength(0);
    // Switching the card off and on again is an edit that rebuilds it.
    await act(async () => switchNamed(el, m.salesforce.title).click());
    await settle();
    expect(lastSaved('salesforce')).toEqual({ ...salesforce(), enabled: false });
    expect(lastSaved('salesforce')).not.toHaveProperty('events');
  });

  it('writes explicit events when flipped, and warns about the placeholder Lead while on', async () => {
    const el = await mount([salesforce()]);
    await act(async () => partialsSwitch(el, 'salesforce').click());
    await settle();
    expect(isOn(partialsSwitch(el, 'salesforce'))).toBe(true);
    expect(lastSaved('salesforce')?.events).toEqual(['partial', 'complete']);
    const warning = q(el, 'salesforce-partials-warning')?.textContent ?? '';
    expect(warning).toContain('[not provided]');
    expect(warning).toMatch(/last name or company/);
    await act(async () => partialsSwitch(el, 'salesforce').click());
    await settle();
    expect(lastSaved('salesforce')?.events).toEqual(['complete']);
    expect(q(el, 'salesforce-partials-warning')).toBeNull();
  });

  it('reads stored events as written and saves them back unchanged', async () => {
    const stored = salesforce({ events: ['partial', 'complete'] });
    const el = await mount([stored]);
    expect(isOn(partialsSwitch(el, 'salesforce'))).toBe(true);
    await act(async () => switchNamed(el, m.salesforce.title).click());
    await settle();
    expect(lastSaved('salesforce')).toEqual({ ...stored, enabled: false });
  });

  it('marks the switch paused while spam protection holds partials', async () => {
    const el = await mount([salesforce({ events: ['partial', 'complete'] })], { partialsHeld: true });
    expect(q(el, 'salesforce-partials-held')?.textContent).toBe(m.eventPartialHeld);
    const off = await mount([salesforce()], { partialsHeld: true });
    expect(q(off, 'salesforce-partials-held')).toBeNull();
  });

  it('speaks Spanish on a Spanish tab', async () => {
    const es = getMessages('es').admin.integrations;
    const el = await mount([salesforce({ events: ['partial', 'complete'] })], { locale: 'es' });
    expect(q(el, 'salesforce-partials')?.textContent).toContain(es.crmPartials);
    expect(q(el, 'salesforce-partials-warning')?.textContent).toContain('[not provided]');
    expect(q(el, 'salesforce-partials-warning')?.textContent).toMatch(/apellido o empresa/);
  });
});

describe('Google Sheets: complete responses only', () => {
  it('says so on the card', async () => {
    const sheets = {
      type: 'google-sheets',
      enabled: true,
      settings: { spreadsheetId: 'sheet-1' },
      columns: [{ header: 'Email', source: 'answer', key: 'email' }],
    } as unknown as FormDestination;
    const el = await mount([sheets], { googleSheetsConnected: true });
    expect(q(el, 'gsheets-complete-only')?.textContent).toBe(m.gsheetsCompleteOnly);
  });
});
