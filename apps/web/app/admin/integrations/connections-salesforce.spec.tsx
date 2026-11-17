// @vitest-environment happy-dom
/**
 * Connecting Salesforce from the Connections page.
 *
 * The card asks for three values, not a token, and carries the one-time setup
 * on its face, because the person filling it in is often not the Salesforce
 * admin. A refusal must name which thing to fix, the ten-minute propagation
 * wait included, rather than a generic "could not connect".
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
  disconnectIntegrationAction: vi.fn(),
}));
vi.mock('./actions', () => actions);

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/components/toast', () => ({ useToast: () => toasts }));

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import { ConnectionsPanel } from './connections-panel';

const m = getMessages('en').admin.connections;

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

async function mount(providers: IntegrationStatus[] = []) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <ConnectionsPanel initialProviders={providers} encryptionAvailable messages={m} locale="en" />,
    );
  });
  return container;
}

const salesforceCard = (el: HTMLElement) =>
  [...el.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === m.salesforceName)!;

/** Type into a React-controlled input the way a person does. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function openForm(el: HTMLElement) {
  const card = salesforceCard(el);
  const connect = [...card.querySelectorAll('button')].find((b) => b.textContent?.includes(m.connect))!;
  await act(async () => connect.click());
  return card;
}

async function fillAndSubmit(card: HTMLElement, values = ['acme.my.salesforce.com', 'KEY1234', 'SECRET']) {
  const inputs = card.querySelectorAll<HTMLInputElement>('[data-testid="salesforce-connect-form"] input');
  await act(async () => {
    inputs.forEach((input, i) => type(input, values[i] ?? ''));
  });
  const submit = [...card.querySelectorAll('[data-testid="salesforce-connect-form"] button')].find(
    (b) => b.textContent === m.connect,
  ) as HTMLButtonElement;
  await act(async () => submit.click());
}

describe('the Salesforce connection card', () => {
  it('asks for My Domain, Consumer Key and a hidden Consumer Secret, with the setup on the card', async () => {
    const card = await openForm(await mount());
    const form = card.querySelector('[data-testid="salesforce-connect-form"]')!;
    expect(form.textContent).toContain(m.salesforceSetupTitle);
    for (const step of m.salesforceSetupSteps) expect(form.textContent).toContain(step);
    expect(form.textContent).toContain(m.salesforceEditionNote);
    const inputs = form.querySelectorAll('input');
    expect([...inputs].map((i) => i.type)).toEqual(['text', 'text', 'password']);
  });

  it('refuses to send with a field missing', async () => {
    const card = await openForm(await mount());
    await fillAndSubmit(card, ['acme.my.salesforce.com', 'KEY1234', '']);
    expect(actions.connectSalesforceAction).not.toHaveBeenCalled();
    expect(card.querySelector('[data-testid="salesforce-connect-problem"]')?.textContent).toBe(
      m.salesforceFieldsRequired,
    );
  });

  it.each(['domain_invalid', 'invalid_client', 'no_run_as', 'rejected', 'unreachable'] as const)(
    'explains a %s refusal in its own words',
    async (reason) => {
      actions.connectSalesforceAction.mockResolvedValue({ ok: false, reason });
      const card = await openForm(await mount());
      await fillAndSubmit(card);
      expect(card.querySelector('[data-testid="salesforce-connect-problem"]')?.textContent).toBe(
        m.salesforceErrors[reason],
      );
    },
  );

  it('sends the three values, then shows the org it connected to', async () => {
    actions.connectSalesforceAction.mockResolvedValue({
      ok: true,
      status: { provider: 'salesforce', connected: true, last4: '1234', label: 'Acme Inc', connectedAt: 1 },
    });
    const card = await openForm(await mount());
    await fillAndSubmit(card);
    expect(actions.connectSalesforceAction).toHaveBeenCalledWith({
      domain: 'acme.my.salesforce.com',
      consumerKey: 'KEY1234',
      consumerSecret: 'SECRET',
    });
    expect(card.textContent).toContain('Acme Inc');
    expect(card.querySelector('[data-testid="salesforce-connect-form"]')).toBeNull();
  });
});
