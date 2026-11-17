// @vitest-environment happy-dom
/**
 * Connecting from the form, and the autosave pill.
 *
 * The Connect tab used to send an author who had not connected HubSpot to
 * another page ("Go to Connections", a page the sidebar calls Integrations),
 * and the autosave state was a faint pill at the end of a long column. Both
 * are pinned here: HubSpot connects in place with its pasted token and the
 * mapping opens without a reload; a member is told an admin has to do it; the
 * pill sits fixed in the corner on wide screens, in the flow on a phone, and
 * says each state in its own tone.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ContactKeyReadiness } from '@quill/engine';
import { getMessages } from '@quill/shared';

const connectActions = vi.hoisted(() => ({
  connectIntegrationAction: vi.fn(),
  connectSalesforceAction: vi.fn(),
  startGoogleSheetsAuthAction: vi.fn(),
}));
vi.mock('@/app/admin/integrations/actions', () => connectActions);

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() }));
vi.mock('@/components/toast', () => ({ useToast: () => toasts }));

import { HubspotCard, SaveStatusPill } from './integrations-editor';
import type { ConnectAccess } from './connect-in-place';

const m = getMessages('en').admin.integrations;
const cm = getMessages('en').admin.connections;
const ready = { ok: true, blocker: null, source: { kind: 'question', key: 'email' } } as ContactKeyReadiness;

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

async function render(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(node));
  return container;
}

function hubspot(opts: { access?: ConnectAccess; onConnected?: () => void } = {}) {
  return (
    <HubspotCard
      state={{
        enabled: true,
        fieldMappings: [],
        utmMappings: {},
        scoreProperty: '',
        dateProperty: '',
        note: true,
        formActivity: false,
        valueMaps: [],
        outcomeProperty: '',
        staticProperties: [],
        inferCompanyFromEmail: false,
        bookingSync: { stageProperty: '', stageValue: '', dateProperty: '', hoursProperty: '' },
        dayTimezone: '',
      }}
      onChange={() => {}}
      properties={[]}
      pickerEnabled={false}
      accountConnected={false}
      showMapping={false}
      extraHubspotStored={false}
      readiness={ready}
      questions={[{ key: 'email', type: 'email', label: 'Email' }]}
      formId="form-1"
      access={opts.access}
      locale="en"
      onConnected={opts.onConnected}
      m={m}
    />
  );
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('HubSpot connects in place', () => {
  it('offers the token field on the card, and no link away from the form', async () => {
    const el = await render(hubspot());
    const prompt = el.querySelector('[data-testid="hubspot-connect-prompt"]')!;
    expect(prompt.textContent).toContain(m.connectPromptTitle);
    expect(prompt.querySelector('input[type="password"]')).not.toBeNull();
    expect(el.querySelector('a[href="/admin/integrations"]')).toBeNull();
    expect(el.textContent).not.toContain('Connections');
  });

  it('connects with the pasted token, then asks the editor to load the properties', async () => {
    connectActions.connectIntegrationAction.mockResolvedValueOnce({
      ok: true,
      status: { provider: 'hubspot', connected: true, last4: 'abcd', label: 'HubSpot', connectedAt: 1 },
    });
    const onConnected = vi.fn();
    const el = await render(hubspot({ onConnected }));
    await act(async () => type(el.querySelector<HTMLInputElement>('input[type="password"]')!, ' pat-na1-xyz '));
    const connect = [...el.querySelectorAll('button')].find((b) => b.textContent === cm.connect)!;
    await act(async () => connect.click());
    expect(connectActions.connectIntegrationAction).toHaveBeenCalledWith('hubspot', 'pat-na1-xyz');
    expect(onConnected).toHaveBeenCalled();
  });

  it('says what went wrong on the card when the token is refused', async () => {
    connectActions.connectIntegrationAction.mockResolvedValueOnce({ ok: false });
    const el = await render(hubspot());
    await act(async () => type(el.querySelector<HTMLInputElement>('input[type="password"]')!, 'bad'));
    const connect = [...el.querySelectorAll('button')].find((b) => b.textContent === cm.connect)!;
    await act(async () => connect.click());
    expect(el.querySelector('[data-testid="token-connect-problem"]')?.textContent).toBe(cm.connectError);
  });

  it('tells a member an admin has to connect it', async () => {
    const el = await render(hubspot({ access: { canConnect: false, encryptionAvailable: true } }));
    expect(el.querySelector('[data-testid="connect-admin-only"]')?.textContent).toContain('HubSpot');
    expect(el.querySelector('input')).toBeNull();
  });

  it('says the deployment cannot store a credential, instead of a form that would fail', async () => {
    const el = await render(hubspot({ access: { canConnect: true, encryptionAvailable: false } }));
    expect(el.textContent).toContain(cm.encryptionOff);
    expect(el.querySelector('input')).toBeNull();
  });
});

describe('the autosave pill', () => {
  const fixed = () => document.body.querySelector<HTMLElement>('[data-testid="integrations-save-status"]')!;

  it('is fixed to the bottom-right of the window on wide screens, outside the editor', async () => {
    const el = await render(<SaveStatusPill status="saved" detail={null} m={m} />);
    // Portalled to body, so no ancestor's stacking context can pin it elsewhere.
    expect(el.contains(fixed())).toBe(false);
    expect(fixed().className).toMatch(/\bfixed\b/);
    expect(fixed().className).toContain('bottom-5');
    expect(fixed().className).toContain('right-5');
    expect(fixed().className).toContain('sm:block');
    expect(fixed().textContent).toBe(m.autosaved);
  });

  it('sits in the flow on a phone, where a floating pill would cover controls', async () => {
    const el = await render(<SaveStatusPill status="saved" detail={null} m={m} />);
    const inline = el.querySelector<HTMLElement>('[data-testid="integrations-save-status-inline"]')!;
    expect(inline.className).toContain('sm:hidden');
    expect(inline.className).not.toMatch(/\bfixed\b/);
  });

  it.each([
    ['saved', 'bg-signal/15'],
    ['error', 'text-destructive'],
    ['retrying', 'bg-warning/10'],
    ['partial', 'bg-warning/10'],
    ['saving', 'bg-card'],
    ['pending', 'pi-info-circle'],
  ] as const)('gives %s its own tone, from tokens', async (status, tone) => {
    await render(<SaveStatusPill status={status} detail={null} m={m} />);
    expect(fixed().getAttribute('data-status')).toBe(status);
    expect(fixed().innerHTML).toContain(tone);
    expect(fixed().innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  it('does not claim a switch-on it could not store as saved', async () => {
    await render(<SaveStatusPill status="pending" detail={null} m={m} />);
    expect(fixed().textContent).toBe(m.autosavedPendingSheet);
    expect(fixed().innerHTML).not.toContain('bg-signal');
  });

  it('lifts the toasts above itself while it is on screen', async () => {
    await render(<SaveStatusPill status="saved" detail={null} m={m} />);
    expect(document.documentElement.classList.contains('has-save-pill')).toBe(true);
    act(() => root?.unmount());
    root = null;
    expect(document.documentElement.classList.contains('has-save-pill')).toBe(false);
  });

  it('shows the error detail in the destructive tone', async () => {
    await render(<SaveStatusPill status="error" detail="Network down" m={m} />);
    expect(fixed().textContent).toBe('Network down');
  });
});
