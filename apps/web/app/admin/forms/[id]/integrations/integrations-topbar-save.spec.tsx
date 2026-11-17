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
  mergeIntegrationCardAction: vi.fn(),
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
import { publishIntegrationsSave, readCombinedSave as readCombined, readIntegrationsSave } from '@/lib/integrations-save-status';
import { awaitPendingDestinationWrite } from '@/lib/connect-sync';

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

async function mount(formId: string, extra: Partial<React.ComponentProps<typeof IntegrationsEditor>> = {}) {
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
        {...extra}
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

describe('a save that fails after the tab is left', () => {
  it('retries a bounded number of times, then says "not saved" without promising a retry', async () => {
    actions.saveIntegrationsAction.mockRejectedValue(new Error('network down'));
    const el = await mount('form-lost');
    await edit(el);
    act(() => root!.unmount());
    root = null;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    // One terminal save plus the bounded retries, and then it stops.
    expect(actions.saveIntegrationsAction).toHaveBeenCalledTimes(3);
    const state = readIntegrationsSave('form-lost');
    expect(state?.status).toBe('error');
    expect(state?.lost).toBe(true);
    expect(state?.detail).toBe(m.saveLostAfterLeave);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(actions.saveIntegrationsAction).toHaveBeenCalledTimes(3);
  });

  it('on coming back, says once that the change was lost, and the state stays an error', async () => {
    publishIntegrationsSave('form-back', { status: 'error', detail: m.saveLostAfterLeave, lost: true });
    await mount('form-back');
    expect(toasts.error).toHaveBeenCalledWith(m.saveLostAfterLeave);
    // Not "saved" beside the notice: the topbar and the pill stay on the
    // error until a later save succeeds (see the next spec).
    expect(readIntegrationsSave('form-back')).toMatchObject({ status: 'error', lost: true });
    expect(readCombined('form-back')).toMatchObject({ status: 'error', lost: true });
    // The pill says it too, before any edit on this visit.
    expect(document.body.querySelector('[data-testid="integrations-save-status"]')?.getAttribute('data-status')).toBe(
      'error',
    );
  });

  it('saves after the tab is left when a retry gets through', async () => {
    actions.saveIntegrationsAction.mockRejectedValueOnce(new Error('blip')).mockResolvedValue({ ok: true });
    const el = await mount('form-blip');
    await edit(el);
    act(() => root!.unmount());
    root = null;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(readIntegrationsSave('form-blip')?.status).toBe('saved');
  });

  it('a later successful save clears a lost one', async () => {
    publishIntegrationsSave('form-clear', { status: 'error', detail: m.saveLostAfterLeave, lost: true });
    actions.saveIntegrationsAction.mockResolvedValue({ ok: true });
    const el = await mount('form-clear');
    await edit(el);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(readIntegrationsSave('form-clear')).toMatchObject({ status: 'saved' });
    expect(readIntegrationsSave('form-clear')?.lost).toBeFalsy();
  });
});

/**
 * A card action that finishes after the tab was left.
 *
 * "Create sheet" is pressed, the author moves to Build, and Google answers a
 * moment later: the spreadsheet now exists in their Drive. The card's result
 * used to go to an editor whose autosave was already disposed: it published
 * "Saving", nothing ever saved, the topbar sat on "Saving" until the next
 * visit to Connect, and the new spreadsheet was never attached to the form.
 */
describe('an action that finishes after the tab is left', () => {
  const sheetsOn = {
    googleSheetsAvailable: true,
    googleSheetsConnected: true,
    initialDestinations: [{ type: 'google-sheets' as const, enabled: true, settings: {}, columns: [] }],
  };
  const createButton = (el: HTMLElement) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(m.gsheets.createSheet))!;

  it('attaches the created spreadsheet through the save queue, and the topbar ends on saved', async () => {
    let answer!: (v: unknown) => void;
    actions.googleSheetsCreateAction.mockImplementation(() => new Promise((r) => (answer = r)));
    actions.mergeIntegrationCardAction.mockResolvedValue({ ok: true });
    const el = await mount('form-late', sheetsOn);
    await act(async () => createButton(el).click());
    // Leave the tab before Google answers.
    act(() => root!.unmount());
    root = null;
    await act(async () => {
      answer({ ok: true, data: { ok: true, spreadsheetId: 'sheet-new', spreadsheetTitle: 'Leads', sheetTitle: 'Responses', gid: 0 } });
      await vi.advanceTimersByTimeAsync(0);
    });
    // Saved: merged onto what the form stores now, not this editor's old snapshot.
    expect(actions.mergeIntegrationCardAction).toHaveBeenCalledTimes(1);
    const [formId, card] = actions.mergeIntegrationCardAction.mock.calls[0]!;
    expect(formId).toBe('form-late');
    expect(card).toMatchObject({ type: 'google-sheets', settings: { spreadsheetId: 'sheet-new', sheetTitle: 'Responses' } });
    expect((card as { columns: unknown[] }).columns.length).toBeGreaterThan(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(readIntegrationsSave('form-late')?.status).toBe('saved');
    expect(readCombined('form-late').status).toBe('saved');
  });

  it('a Connect tab opened again before Google answers waits for the sheet to be attached', async () => {
    let answer!: (v: unknown) => void;
    let landed!: (v: unknown) => void;
    actions.googleSheetsCreateAction.mockImplementation(() => new Promise((r) => (answer = r)));
    actions.mergeIntegrationCardAction.mockImplementation(() => new Promise((r) => (landed = r)));
    const el = await mount('form-reopen', sheetsOn);
    await act(async () => createButton(el).click());
    act(() => root!.unmount());
    root = null;
    let mayRead = false;
    void awaitPendingDestinationWrite('form-reopen').then(() => (mayRead = true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mayRead).toBe(false);
    await act(async () => {
      answer({ ok: true, data: { ok: true, spreadsheetId: 'sheet-new', spreadsheetTitle: 'Leads', sheetTitle: 'Responses', gid: 0 } });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mayRead).toBe(false); // created, not yet attached
    await act(async () => {
      landed({ ok: true });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mayRead).toBe(true);
  });

  it('says nothing when the late action failed: there is nothing to save', async () => {
    let answer!: (v: unknown) => void;
    actions.googleSheetsCreateAction.mockImplementation(() => new Promise((r) => (answer = r)));
    const el = await mount('form-nosave', sheetsOn);
    await act(async () => createButton(el).click());
    act(() => root!.unmount());
    root = null;
    await act(async () => {
      answer({ ok: true, data: { ok: false, reason: 'unavailable' } });
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(actions.mergeIntegrationCardAction).not.toHaveBeenCalled();
    expect(actions.saveIntegrationsAction).not.toHaveBeenCalled();
    expect(readIntegrationsSave('form-nosave')?.status).not.toBe('saving');
  });
});

/**
 * A lost change used to be said in a toast on EVERY visit to the tab, and the
 * topbar and the pill stayed in error for the whole session with no way to
 * put it down short of making another edit.
 */
describe('a lost change is said once and can be dismissed', () => {
  it('toasts once across three visits to the tab', async () => {
    publishIntegrationsSave('form-nag', { status: 'error', detail: m.saveLostAfterLeave, lost: true });
    for (let visit = 0; visit < 3; visit++) {
      await mount('form-nag');
      act(() => root!.unmount());
      container!.remove();
      root = null;
    }
    expect(toasts.error).toHaveBeenCalledTimes(1);
    // Unacknowledged: still an error, still visible.
    expect(readCombined('form-nag')).toMatchObject({ status: 'error', lost: true });
  });

  it('shows a notice on the page that stays until dismissed, and dismissing it clears the error', async () => {
    publishIntegrationsSave('form-ack', { status: 'error', detail: m.saveLostAfterLeave, lost: true });
    const el = await mount('form-ack');
    const notice = () => el.querySelector('[data-testid="integrations-lost-notice"]');
    expect(notice()?.textContent).toContain(m.saveLostAfterLeave);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(notice()).not.toBeNull();
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="integrations-lost-dismiss"]')!.click());
    expect(notice()).toBeNull();
    expect(readIntegrationsSave('form-ack')).toEqual({ status: 'saved' });
    expect(readCombined('form-ack')).toMatchObject({ status: 'saved', lost: false });
  });
});
