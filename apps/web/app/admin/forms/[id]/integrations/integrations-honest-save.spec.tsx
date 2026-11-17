// @vitest-environment happy-dom
/**
 * Nothing the Connect tab calls saved may be lost on a reload, and the pill
 * and the topbar never disagree.
 *
 *  - A half-filled HubSpot row (a key with no property, a fixed value with no
 *    property, a value-map row with one side) is stored as a draft and comes
 *    back after a reload. A delivery reads only the complete mappings.
 *  - A webhook URL that is not valid leaves the webhook out of the save: that
 *    is `partial`, not saved, for the pill and the topbar alike.
 *  - Leaving the tab while an older save is in flight never writes the older
 *    snapshot over the newer one (the reported data loss).
 *  - The pill says nothing on load, before the author edits anything.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getMessages } from '@quill/shared';
import { formDestinationSchema, type FormDestination } from '@quill/types';

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

import { hubspotDrafts, initialHubspot, IntegrationsEditor } from './integrations-editor';
import { readIntegrationsSave, worseSaveStatus } from '@/lib/integrations-save-status';
import { resetIntegrationsSaveQueues } from '@/lib/integrations-save-queue';

const m = getMessages('en').admin.integrations;
let root: Root | null = null;
let container: HTMLElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  resetIntegrationsSaveQueues();
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function mount(formId: string, initialDestinations: FormDestination[] = [], extra: Record<string, unknown> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <IntegrationsEditor
        id={formId}
        initialDestinations={initialDestinations}
        hubspot={{ enabled: false, reason: 'not connected' }}
        hubspotConnected={false}
        questions={[{ key: 'email', label: 'Email', type: 'email' }]}
        messages={m}
        locale="en"
        {...extra}
      />,
    );
  });
  return container;
}

const sw = (el: HTMLElement, label: string) =>
  el.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${label}"]`)!;

describe('HubSpot: half-filled rows survive a reload', () => {
  it('stores them as drafts and reads them back, after the complete ones', () => {
    const before = initialHubspot([]);
    const state = {
      ...before,
      enabled: true,
      fieldMappings: [
        { key: 'email', property: 'email' },
        { key: 'utm_source', property: '' },
      ],
      staticProperties: [{ key: 'lifecyclestage', value: '' }],
      valueMaps: [
        { stepKey: 'role', rows: [{ from: 'founder', to: 'Founder' }, { from: 'lead', to: '' }] },
        { stepKey: '', rows: [{ from: 'x', to: 'y' }] },
      ],
    };
    const drafts = hubspotDrafts(state)!;
    expect(drafts).toEqual({
      mappings: [{ key: 'utm_source', property: '' }],
      statics: [{ key: 'lifecyclestage', value: '' }],
      valueMaps: [
        { stepKey: 'role', rows: [{ from: 'lead', to: '' }] },
        { stepKey: '', rows: [{ from: 'x', to: 'y' }] },
      ],
    });
    // A reload: the stored destination through the API's own schema.
    const stored = formDestinationSchema.parse({
      type: 'hubspot',
      enabled: true,
      fieldMappings: { email: 'email' },
      valueMaps: { role: { founder: 'Founder' } },
      drafts,
    });
    const back = initialHubspot([stored as FormDestination]);
    expect(back.fieldMappings).toEqual(state.fieldMappings);
    expect(back.staticProperties).toEqual(state.staticProperties);
    expect(back.valueMaps).toEqual(state.valueMaps);
  });

  it('keeps a stored config without drafts exactly as it was', () => {
    const legacy = formDestinationSchema.parse({ type: 'hubspot', enabled: true, fieldMappings: { email: 'email' } });
    expect(legacy).not.toHaveProperty('drafts');
    expect(hubspotDrafts(initialHubspot([legacy as FormDestination]))).toBeUndefined();
  });
});

describe('a webhook URL that is not valid is not saved, and both indicators say so', () => {
  it('publishes partial, which the topbar ranks above saved', async () => {
    actions.saveIntegrationsAction.mockResolvedValue({ ok: true });
    const el = await mount('form-partial');
    await act(async () => sw(el, 'Webhook').click());
    const url = el.querySelector<HTMLInputElement>('input[type="url"], input[placeholder^="https"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(url, 'not a url');
      url.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    const state = readIntegrationsSave('form-partial');
    expect(state?.status).toBe('partial');
    expect(state?.detail).toContain(m.autosavedPartial);
    // The topbar's worse-of: a partial save is never shown as "saved".
    expect(worseSaveStatus('saved', state!.status)).toBe('partial');
    const pill = document.body.querySelector('[data-testid="integrations-save-status"]')!;
    expect(pill.getAttribute('data-status')).toBe('partial');
  });
});

describe('leaving the tab while an older save is in flight', () => {
  it('ends with the latest edit stored and no false "lost" (the reported repro)', async () => {
    const written: unknown[] = [];
    let failFirst!: (e: Error) => void;
    actions.saveIntegrationsAction
      .mockImplementationOnce((_id: string, d: unknown) => {
        written.push(d);
        return new Promise((_, reject) => (failFirst = reject));
      })
      .mockImplementation(async (_id: string, d: unknown) => {
        written.push(d);
        return { ok: true };
      });
    const el = await mount('form-race');
    await act(async () => sw(el, 'Salesforce').click()); // S1: Salesforce on
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(written).toHaveLength(1);
    await act(async () => sw(el, 'Salesforce').click()); // off again
    act(() => root!.unmount()); // leave the tab: the final save S2 queues
    root = null;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      failFirst(new Error('network down')); // S1 fails
      await vi.advanceTimersByTimeAsync(60_000);
    });
    // S1 then S2, and nothing after: the old snapshot is never written again.
    expect(written).toHaveLength(2);
    expect(written.at(-1)).toEqual([]);
    expect(readIntegrationsSave('form-race')?.status).toBe('saved');
    expect(readIntegrationsSave('form-race')?.lost).toBeFalsy();
    // Coming back: no "your change was lost" for a change that was saved.
    await mount('form-race');
    expect(toasts.error).not.toHaveBeenCalled();
  });
});

describe('the pill on load', () => {
  it('does not render before an edit, even for a card with something to say', async () => {
    await mount('form-load', [
      { type: 'google-sheets', enabled: true, settings: {}, columns: [] } as unknown as FormDestination,
    ]);
    expect(document.body.querySelector('[data-testid="integrations-save-status"]')).toBeNull();
  });
});
