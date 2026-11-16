// @vitest-environment happy-dom
/**
 * dCal on the Connections page, and why a Salesforce connection failed.
 *
 * dCal is not a connection (it uses the author's Dapta sign-in), so its card
 * is about presence: it sits right above Calendly, shows only on a deployment
 * that has dCal, and its "Connect" opens the steps to use it rather than a
 * credential form.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getMessages } from '@quill/shared';

const actions = vi.hoisted(() => ({
  startGoogleSheetsAuthAction: vi.fn(),
  connectIntegrationAction: vi.fn(),
  connectSalesforceAction: vi.fn(),
  disconnectIntegrationAction: vi.fn(),
}));
vi.mock('./actions', () => actions);
vi.mock('@/components/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }) }));

import { ConnectionsPanel, salesforceProblem } from './connections-panel';

const m = getMessages('en').admin.connections;
const URL_ = 'https://book.dcal.example/admin/event-types';

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
});

async function mount(dcal: { createEventUrl: string } | null) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <ConnectionsPanel initialProviders={[]} encryptionAvailable dcal={dcal} messages={m} locale="en" />,
    );
  });
  return container;
}

const cardNames = (el: HTMLElement) => [...el.querySelectorAll('section h2')].map((h) => h.textContent);

describe('the dCal card', () => {
  it('sits right above Calendly', async () => {
    const names = cardNames(await mount({ createEventUrl: URL_ }));
    expect(names.indexOf(m.dcalName)).toBe(names.indexOf(m.calendlyName) - 1);
  });

  it('is left out on a deployment without dCal', async () => {
    expect(cardNames(await mount(null))).not.toContain(m.dcalName);
  });

  it('opens the steps and a link to dCal instead of asking for a credential', async () => {
    const el = await mount({ createEventUrl: URL_ });
    const card = el.querySelector('[data-testid="dcal-card"]')!;
    expect(card.querySelector('input')).toBeNull();
    const connect = [...card.querySelectorAll('button')].find((b) => b.textContent?.includes(m.connect))!;
    await act(async () => connect.click());
    const steps = card.querySelector('[data-testid="dcal-steps"]')!;
    for (const step of m.dcalSteps) expect(steps.textContent).toContain(step);
    const link = card.querySelector<HTMLAnchorElement>('[data-testid="dcal-open"]')!;
    expect(link.getAttribute('href')).toBe(URL_);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});

describe('why a Salesforce connection failed', () => {
  it('says the button gave up waiting when nothing came back', () => {
    expect(salesforceProblem({ ok: false, transport: true, message: 'timed out after 30000ms' }, m)).toBe(
      m.salesforceErrors.timeout,
    );
  });

  it('names how the call died when Salesforce did not answer', () => {
    expect(salesforceProblem({ ok: false, reason: 'unreachable', status: 400, cause: 'ECONNRESET' }, m)).toBe(
      `${m.salesforceErrors.unreachable} (ECONNRESET)`,
    );
  });

  it("names Salesforce's own refusal", () => {
    expect(salesforceProblem({ ok: false, reason: 'no_run_as', status: 400 }, m)).toBe(m.salesforceErrors.no_run_as);
  });

  it('says a role that may not connect, on a 403', () => {
    expect(salesforceProblem({ ok: false, status: 403, message: 'Forbidden' }, m)).toBe(m.salesforceErrors.forbidden);
  });

  it("otherwise shows the API's own message beside the generic line", () => {
    expect(salesforceProblem({ ok: false, status: 400, message: 'server encryption key not configured' }, m)).toBe(
      `${m.connectError} (server encryption key not configured)`,
    );
  });
});
