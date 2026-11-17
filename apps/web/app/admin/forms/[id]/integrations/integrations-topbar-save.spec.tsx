// @vitest-environment happy-dom
/**
 * The editor's topbar shows the Connect tab's integrations save too, and it
 * must end on the truth even when the tab is left before the save runs.
 *
 * The state used to be published by an effect of the mounted editor. Leave
 * the tab inside the 900 ms debounce and the controller's terminal save ran
 * after the effect was gone: the topbar stayed on "Saving" forever, or on
 * "Not saved" after a retry that had in fact succeeded. It is published from
 * the save itself now, which every save runs through, the terminal one too.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getMessages } from '@quill/shared';

const actions = vi.hoisted(() => ({
  saveIntegrationsAction: vi.fn(),
  pingWebhookAction: vi.fn(),
  hubspotPropertiesAction: vi.fn(),
  loadDeliveryHistoryAction: vi.fn(async () => []),
  googleSheetsCreateAction: vi.fn(),
  googleSheetsPickerAction: vi.fn(),
  googleSheetsTabsAction: vi.fn(),
  syncSheetHeadersAction: vi.fn(),
  salesforceFieldsAction: vi.fn(),
}));
vi.mock('./actions', () => actions);
vi.mock('@/app/admin/integrations/actions', () => ({
  connectIntegrationAction: vi.fn(),
  connectSalesforceAction: vi.fn(),
  startGoogleSheetsAuthAction: vi.fn(),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() }) }));

import { IntegrationsEditor } from './integrations-editor';
import { readIntegrationsSave } from '@/lib/integrations-save-status';

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
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function mount(formId: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <IntegrationsEditor
        id={formId}
        initialDestinations={[]}
        hubspot={{ enabled: false, reason: 'not connected' }}
        hubspotConnected={false}
        questions={[{ key: 'email', label: 'Email', type: 'email' }]}
        messages={m}
        locale="en"
      />,
    );
  });
  return container;
}

/** One edit: switch the Salesforce card on. */
async function edit(el: HTMLElement) {
  await act(async () => el.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Salesforce"]')!.click());
}

describe('the topbar ends on the truth', () => {
  it('shows saved after the tab is left inside the debounce and the save lands', async () => {
    let resolve!: (v: unknown) => void;
    actions.saveIntegrationsAction.mockImplementation(() => new Promise((r) => (resolve = r)));
    const el = await mount('form-left');
    await edit(el);
    expect(readIntegrationsSave('form-left')?.status).toBe('saving');
    // Leave the tab before 900 ms: the controller fires its terminal save.
    act(() => root!.unmount());
    root = null;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(actions.saveIntegrationsAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ ok: true });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(readIntegrationsSave('form-left')?.status).toBe('saved');
  });

  it('shows saved after a failed save is retried successfully', async () => {
    actions.saveIntegrationsAction
      .mockResolvedValueOnce({ ok: false, message: 'Server said no' })
      .mockResolvedValue({ ok: true });
    const el = await mount('form-retry');
    await edit(el);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(readIntegrationsSave('form-retry')).toMatchObject({ status: 'error', detail: 'Server said no' });
    // The controller retries a server error with backoff.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(actions.saveIntegrationsAction.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(readIntegrationsSave('form-retry')?.status).toBe('saved');
  });
});
