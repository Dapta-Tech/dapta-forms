// @vitest-environment happy-dom
/**
 * The Google Sheets card, which is the one connection on this page that is not
 * made by pasting a token.
 *
 * Four promises, each of which a well-meaning edit could break without failing
 * anything else:
 *
 *   1. the card offers a consent round trip, NOT a token field. A token box
 *      here would collect something the operator cannot have, and the API would
 *      refuse it.
 *   2. the browser goes to the URL the server action returned, verbatim. The
 *      account this flow connects rides in a signed state inside that URL, so a
 *      rebuilt or edited URL connects nothing.
 *   3. nothing is stored on this side when the flow is started, so abandoning
 *      the consent screen leaves no half-made connection.
 *   4. the outcome of a finished round trip is announced once and the flag is
 *      taken out of the address, so a reload cannot re-announce it.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getMessages } from '@quill/shared';
import type { IntegrationProvider, IntegrationStatus } from '@/lib/admin-api';

const actions = vi.hoisted(() => ({
  startGoogleSheetsAuthAction: vi.fn(),
  connectIntegrationAction: vi.fn(),
  disconnectIntegrationAction: vi.fn(),
}));
vi.mock('./actions', () => actions);

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/components/toast', () => ({ useToast: () => toasts }));

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import { ConnectionsPanel, type OauthOutcome } from './connections-panel';

const m = getMessages('en').admin.connections;

let root: Root | null = null;
let container: HTMLElement | null = null;
const assign = vi.fn();

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom refuses a real navigation; what these specs read is that the page ASKS
  // for one, with the exact URL the server action handed back.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function mount(
  opts: {
    providers?: IntegrationStatus[];
    outcome?: OauthOutcome | null;
    unavailable?: IntegrationProvider[];
  } = {},
) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <ConnectionsPanel
        initialProviders={opts.providers ?? []}
        encryptionAvailable
        serverProvided={[]}
        unavailable={opts.unavailable ?? []}
        oauthOutcome={opts.outcome ?? null}
        messages={m}
        locale="en"
      />,
    );
  });
  return container;
}

/** The Google Sheets card, found by its own mark rather than by position. */
const card = (el: HTMLElement): HTMLElement =>
  el.querySelector<HTMLElement>('[data-provider-logo="gsheets"]')!.closest('section')!;

const buttonLabelled = (el: HTMLElement, text: string): HTMLButtonElement | undefined =>
  [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

describe('the Google Sheets card', () => {
  it('offers a consent round trip and no token field', async () => {
    const el = await mount();
    const gsheets = card(el);
    expect(gsheets.textContent).toContain(m.gsheetsName);
    expect(gsheets.textContent).toContain(m.connectWithGoogle);
    expect(gsheets.textContent).toContain(m.gsheetsConnectNote);
    expect(gsheets.querySelector('input')).toBeNull();
  });

  it('is no longer announced as coming soon', async () => {
    const el = await mount();
    expect(el.querySelector('[data-testid="integration-gsheets"]')).toBeNull();
    expect(card(el).textContent).not.toContain(m.comingSoon);
  });

  it('sends the browser to the URL the server returned, verbatim', async () => {
    const authUrl =
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=cid&state=v1.payload.signature';
    actions.startGoogleSheetsAuthAction.mockResolvedValueOnce({ ok: true, authUrl });
    const el = await mount();
    await act(async () => buttonLabelled(card(el), m.connectWithGoogle)!.click());
    expect(assign).toHaveBeenCalledWith(authUrl);
  });

  it('stores nothing on this side when the flow starts', async () => {
    actions.startGoogleSheetsAuthAction.mockResolvedValueOnce({ ok: true, authUrl: 'https://x.test/a' });
    const el = await mount();
    await act(async () => buttonLabelled(card(el), m.connectWithGoogle)!.click());
    expect(actions.connectIntegrationAction).not.toHaveBeenCalled();
  });

  it('says so and navigates nowhere when the flow cannot be started', async () => {
    actions.startGoogleSheetsAuthAction.mockResolvedValueOnce({ ok: false, message: 'no client' });
    const el = await mount();
    await act(async () => buttonLabelled(card(el), m.connectWithGoogle)!.click());
    expect(assign).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith('no client');
  });

  it('shows the connected account once it is connected', async () => {
    const el = await mount({
      providers: [
        {
          provider: 'google-sheets',
          connected: true,
          label: 'ops@example.com',
          last4: 'abcd',
          connectedAt: Date.UTC(2026, 10, 16),
        },
      ],
    });
    const gsheets = card(el);
    expect(gsheets.textContent).toContain('ops@example.com');
    // No "ending in abcd": those are the tail of a token Google issued, which
    // nobody typed and nobody could recognise.
    expect(gsheets.textContent).not.toContain('abcd');
    expect(buttonLabelled(gsheets, m.connectWithGoogle)).toBeUndefined();
    expect(buttonLabelled(gsheets, m.disconnect)).toBeDefined();
  });
});

describe('a deployment with no Google OAuth client', () => {
  const gsheetsMark = (el: HTMLElement) => el.querySelector('[data-provider-logo="gsheets"]');

  it('keeps the card, says it is not available here, and offers no button', async () => {
    const el = await mount({ unavailable: ['google-sheets'] });
    expect(gsheetsMark(el)).not.toBeNull();
    expect(el.textContent).not.toContain(m.connectWithGoogle);
    expect(card(el).querySelector('[data-testid="provider-unavailable"]')?.textContent).toContain(
      m.unavailableTitle,
    );
    expect(el.textContent).toContain(m.hubspotName);
    expect(el.textContent).toContain(m.calendlyName);
  });

  it('keeps the card of an account that is already connected, so it can be removed', async () => {
    const el = await mount({
      unavailable: ['google-sheets'],
      providers: [
        {
          provider: 'google-sheets',
          connected: true,
          label: 'ops@example.com',
          last4: 'abcd',
          connectedAt: Date.UTC(2026, 10, 16),
        },
      ],
    });
    expect(gsheetsMark(el)).not.toBeNull();
    expect(buttonLabelled(card(el), m.disconnect)).toBeDefined();
  });

  it('shows the card when the deployment has one', async () => {
    const el = await mount({ unavailable: [] });
    expect(gsheetsMark(el)).not.toBeNull();
  });
});

describe('the outcome of a finished round trip', () => {
  it('announces a connection and clears the flag from the address', async () => {
    await mount({ outcome: 'connected' });
    expect(toasts.success).toHaveBeenCalledWith(m.googleConnected);
    expect(router.replace).toHaveBeenCalledWith('/admin/integrations');
  });

  it('announces a cancelled consent without alarming anyone', async () => {
    await mount({ outcome: 'cancelled' });
    expect(toasts.error).toHaveBeenCalledWith(m.googleCancelled);
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it('names the missing permission when a scope was unticked', async () => {
    await mount({ outcome: 'scope' });
    expect(toasts.error).toHaveBeenCalledWith(m.googleScopeError);
  });

  it('falls back to the generic failure', async () => {
    await mount({ outcome: 'error' });
    expect(toasts.error).toHaveBeenCalledWith(m.googleError);
  });

  it('announces nothing on an ordinary visit, and leaves the address alone', async () => {
    await mount();
    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('announces once, however many times the effect runs', async () => {
    await mount({ outcome: 'connected' });
    // A re-render with the same prop must not toast again: the flag is already
    // on its way out of the URL.
    await act(async () => {
      root!.render(
        <ConnectionsPanel
          initialProviders={[]}
          encryptionAvailable
          serverProvided={[]}
          oauthOutcome="connected"
          messages={m}
          locale="en"
        />,
      );
    });
    expect(toasts.success).toHaveBeenCalledTimes(1);
  });
});
