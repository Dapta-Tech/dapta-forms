// @vitest-environment happy-dom
/**
 * Connecting HighLevel from the Connections page.
 *
 * Two values, a Private Integration token and the Location ID (or the
 * sub-account's URL), with the setup on the card in HighLevel's own menu
 * labels. A refusal names what to fix, by the API's reason. Connected, the
 * card says which sub-account, its Location ID and the token's last four,
 * and lets an admin replace the token in place. When HighLevel stops
 * accepting the token, the card says so. A member sees all of it, read-only.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getMessages } from '@quill/shared';
import type { IntegrationStatus } from '@/lib/admin-api';

const actions = vi.hoisted(() => ({
  startGoogleSheetsAuthAction: vi.fn(),
  connectIntegrationAction: vi.fn(),
  connectSalesforceAction: vi.fn(),
  connectGoHighLevelAction: vi.fn(),
  disconnectIntegrationAction: vi.fn(),
}));
vi.mock('./actions', () => actions);

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/components/toast', () => ({ useToast: () => toasts }));

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import { ConnectionsPanel } from './connections-panel';

const m = getMessages('en').admin.connections;
const hm = m.highlevel;

const CONNECTED: IntegrationStatus = {
  provider: 'gohighlevel',
  connected: true,
  last4: 'a1b2',
  label: 'Acme Corp (dForms QA)',
  connectedAt: Date.UTC(2026, 10, 17),
  locationId: 'Oy6ErIRwfNUWrddpRjD2',
  rejectedAt: null,
};

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

async function mount(providers: IntegrationStatus[] = [], opts: { canManage?: boolean; locale?: 'en' | 'es' } = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const locale = opts.locale ?? 'en';
  await act(async () => {
    root!.render(
      <ConnectionsPanel
        initialProviders={providers}
        encryptionAvailable
        canManage={opts.canManage ?? true}
        messages={getMessages(locale).admin.connections}
        locale={locale}
      />,
    );
  });
  return container;
}

const card = (el: HTMLElement, name = hm.name) =>
  [...el.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === name)!;

const buttonIn = (scope: Element, text: string) =>
  [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

/** Type into a React-controlled input the way a person does. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function openForm(el: HTMLElement) {
  const c = card(el);
  await act(async () => buttonIn(c, m.connect)!.click());
  return c;
}

async function fillAndSubmit(c: HTMLElement, token = 'pit-test-token', locationId = 'Oy6ErIRwfNUWrddpRjD2') {
  const inputs = c.querySelectorAll<HTMLInputElement>('[data-testid="highlevel-connect-form"] input');
  await act(async () => {
    type(inputs[0]!, token);
    type(inputs[1]!, locationId);
  });
  const form = c.querySelector('[data-testid="highlevel-connect-form"]')!;
  const submit = buttonIn(form, m.connect) ?? buttonIn(form, hm.replaceToken);
  await act(async () => submit!.click());
}

const problem = (c: HTMLElement) => c.querySelector('[data-testid="highlevel-connect-problem"]')?.textContent;

describe('the HighLevel connection card', () => {
  it('carries the three setup steps, the scopes as HighLevel lists them, and where Labs hides the menu', async () => {
    const c = await openForm(await mount());
    const setup = c.querySelector('[data-testid="highlevel-setup"]')!;
    expect(setup.textContent).toContain(hm.setupTitle);
    for (const step of hm.setupSteps) expect(setup.textContent).toContain(step);
    expect(hm.setupSteps[0]).toContain('Settings > Private Integrations');
    expect(hm.setupSteps[0]).toContain('Create new Integration');
    expect(hm.setupSteps[2]).toContain('Settings > Business Profile > General Information');
    expect([...setup.querySelectorAll('code')].map((c) => c.textContent)).toEqual([
      'Edit Contacts - contacts.write',
      'View Locations - locations.readonly',
      'View Custom Fields - locations/customFields.readonly',
    ]);
    expect(setup.textContent).toContain(hm.labsNote);
    expect(hm.labsNote).toContain('Settings > Labs');
  });

  it('asks for a hidden token and a visible Location ID, with what happens to the token', async () => {
    const c = await openForm(await mount());
    const form = c.querySelector('[data-testid="highlevel-connect-form"]')!;
    expect([...form.querySelectorAll('input')].map((i) => i.type)).toEqual(['password', 'text']);
    expect(form.textContent).toContain(hm.secretHelp);
    expect(form.textContent).toContain(hm.locationHelp);
  });

  it('refuses to send with a value missing, or a token that is not a Private Integration token', async () => {
    const c = await openForm(await mount());
    await fillAndSubmit(c, 'pit-1234', '');
    expect(problem(c)).toBe(hm.fieldsRequired);
    await fillAndSubmit(c, 'eyJhbGciOi.agency.key', 'loc');
    expect(problem(c)).toBe(hm.errors.token_format);
    expect(actions.connectGoHighLevelAction).not.toHaveBeenCalled();
  });

  it.each(['token_format', 'invalid_token', 'wrong_location', 'missing_scope', 'unreachable'] as const)(
    'explains a %s refusal in its own words',
    async (reason) => {
      actions.connectGoHighLevelAction.mockResolvedValue({ ok: false, reason, status: 400, code: 'GOHIGHLEVEL_REJECTED' });
      const c = await openForm(await mount());
      await fillAndSubmit(c);
      expect(problem(c)).toBe(hm.errors[reason]);
    },
  );

  it('names how the call died when HighLevel did not answer', async () => {
    actions.connectGoHighLevelAction.mockResolvedValue({ ok: false, reason: 'unreachable', cause: 'ENOTFOUND' });
    const c = await openForm(await mount());
    await fillAndSubmit(c);
    expect(problem(c)).toBe(`${hm.errors.unreachable} (ENOTFOUND)`);
  });

  it('says a role may not connect, a server has no encryption key, and a timeout, each in its own words', async () => {
    actions.connectGoHighLevelAction.mockResolvedValueOnce({ ok: false, status: 403, code: 'FORBIDDEN' });
    let c = await openForm(await mount());
    await fillAndSubmit(c);
    expect(problem(c)).toBe(hm.errors.forbidden);

    actions.connectGoHighLevelAction.mockResolvedValueOnce({ ok: false, status: 400, code: 'ENCRYPTION_UNAVAILABLE' });
    await fillAndSubmit(c);
    expect(problem(c)).toBe(`${m.encryptionOff}. ${m.encryptionOffBody}`);

    // `callAction` gives up waiting: the action promise never settles in time.
    actions.connectGoHighLevelAction.mockRejectedValueOnce(new Error('network'));
    c = card(container!);
    await fillAndSubmit(c);
    expect(problem(c)).toBe(hm.errors.timeout);
  });

  it('sends both values, then shows the sub-account, its Location ID and the token’s last four', async () => {
    actions.connectGoHighLevelAction.mockResolvedValue({ ok: true, status: CONNECTED });
    const c = await openForm(await mount());
    await fillAndSubmit(c, '  pit-test-token ', ' https://app.gohighlevel.com/v2/location/Oy6ErIRwfNUWrddpRjD2/dashboard ');
    expect(actions.connectGoHighLevelAction).toHaveBeenCalledWith({
      token: 'pit-test-token',
      locationId: 'https://app.gohighlevel.com/v2/location/Oy6ErIRwfNUWrddpRjD2/dashboard',
    });
    expect(c.textContent).toContain('Connected to Acme Corp (dForms QA)');
    expect(c.querySelector('[data-testid="connection-location"]')?.textContent).toBe(
      'Location ID Oy6ErIRwfNUWrddpRjD2',
    );
    expect(c.textContent).toContain('ending in a1b2');
    expect(buttonIn(c, hm.replaceToken)).toBeDefined();
    expect(buttonIn(c, m.disconnect)).toBeDefined();
    expect(c.querySelector('[data-testid="highlevel-connect-form"]')).toBeNull();
  });

  it('replaces the token in place, with the Location ID filled in and no setup steps', async () => {
    actions.connectGoHighLevelAction.mockResolvedValue({ ok: true, status: { ...CONNECTED, last4: 'z9y8' } });
    const el = await mount([CONNECTED]);
    const c = card(el);
    await act(async () => buttonIn(c, hm.replaceToken)!.click());
    const form = c.querySelector('[data-testid="highlevel-connect-form"]')!;
    expect(form.querySelector('[data-testid="highlevel-setup"]')).toBeNull();
    expect(form.textContent).toContain(hm.replaceNote);
    const location = form.querySelectorAll<HTMLInputElement>('input')[1]!;
    expect(location.value).toBe(CONNECTED.locationId);
    expect(location.readOnly).toBe(true);
    expect(form.textContent).toContain(hm.replaceLocationFixed);
    expect(form.textContent).not.toContain(hm.locationHelp);
    const token = form.querySelector<HTMLInputElement>('input')!;
    await act(async () => type(token, 'pit-new'));
    await act(async () => buttonIn(form, hm.replaceToken)!.click());
    expect(actions.connectGoHighLevelAction).toHaveBeenCalledWith({ token: 'pit-new', locationId: CONNECTED.locationId });
    expect(toasts.success).toHaveBeenCalledWith(hm.replaceSuccess);
    expect(c.textContent).toContain('ending in z9y8');
  });

  it('says HighLevel stopped accepting the token, and offers to replace it', async () => {
    const el = await mount([{ ...CONNECTED, rejectedAt: Date.UTC(2026, 10, 18) }]);
    const c = card(el);
    expect(c.querySelector('[data-testid="connection-status"]')?.getAttribute('data-state')).toBe('rejected');
    expect(c.querySelector('[data-testid="connection-status"]')?.textContent).toBe(hm.rejectedBadge);
    const alert = c.querySelector('[data-testid="connection-rejected"]')!;
    expect(alert.textContent).toContain(hm.rejectedTitle);
    expect(alert.textContent).toContain('Replace the token');
    expect(buttonIn(c, hm.replaceToken)).toBeDefined();
  });

  it('shows a member the connection read-only: no Replace, no Disconnect, and who to ask', async () => {
    const el = await mount([{ ...CONNECTED, rejectedAt: Date.UTC(2026, 10, 18) }], { canManage: false });
    const c = card(el);
    expect(c.textContent).toContain('Connected to Acme Corp (dForms QA)');
    expect(c.querySelector('[data-testid="connection-location"]')).not.toBeNull();
    expect(buttonIn(c, hm.replaceToken)).toBeUndefined();
    expect(buttonIn(c, m.disconnect)).toBeUndefined();
    expect(c.querySelector('[data-testid="provider-admin-only"]')?.textContent).toContain('HighLevel');
    expect(c.querySelector('[data-testid="connection-rejected"]')?.textContent).toContain('Ask an owner or admin');
  });

  it('tells a member an admin has to connect it when nothing is connected', async () => {
    const el = await mount([], { canManage: false });
    const c = card(el);
    expect(c.querySelector('[data-testid="provider-admin-only"]')?.textContent).toContain('HighLevel');
    expect(buttonIn(c, m.connect)).toBeUndefined();
  });

  it('speaks Spanish with tú and says subcuenta', async () => {
    const es = getMessages('es').admin.connections;
    const el = await mount([], { locale: 'es' });
    const c = card(el, es.highlevel.name);
    await act(async () => buttonIn(c, es.connect)!.click());
    expect(c.textContent).toContain('subcuenta');
    expect(c.textContent).toContain(es.highlevel.labsNote);
  });
});
