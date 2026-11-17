// @vitest-environment happy-dom
/**
 * Coming back to the form from Google's consent screen.
 *
 * "Continue with Google" on the spreadsheet card sends the author to Google,
 * and the API's callback returns them to this form with `tab=connect` and an
 * outcome flag. The flag is announced once and taken out of the address (so a
 * reload cannot announce it again), and `tab` is kept, since it is what put
 * the author back on the Connect tab.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getMessages } from '@quill/shared';

vi.mock('./connect-actions', () => ({ loadConnectIntegrationsAction: vi.fn() }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/components/toast', () => ({ useToast: () => toasts }));

import { useGoogleReturnNotice } from './connect-panel';

const c = getMessages('es').admin.connections;
let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.clearAllMocks();
});

function Probe() {
  useGoogleReturnNotice('es');
  return null;
}

async function visit(search: string) {
  window.history.replaceState(null, '', `/admin/forms/f1/edit${search}`);
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => root!.render(<Probe />));
}

describe('the outcome of a Google round trip started from the form', () => {
  it('announces a connection once and keeps the author on the Connect tab', async () => {
    await visit('?tab=connect&google=connected');
    expect(toasts.success).toHaveBeenCalledWith(c.googleConnected);
    expect(window.location.search).toBe('?tab=connect');
  });

  it('says a cancelled or refused consent in its own words', async () => {
    await visit('?tab=connect&google=cancelled');
    expect(toasts.error).toHaveBeenCalledWith(c.googleCancelled);
    act(() => root?.unmount());
    await visit('?tab=connect&error=google_scope');
    expect(toasts.error).toHaveBeenCalledWith(c.googleScopeError);
    expect(window.location.search).toBe('?tab=connect');
  });

  it('says nothing on an ordinary visit', async () => {
    await visit('?tab=connect');
    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
  });
});

describe('the card comes back open', () => {
  it('reports a successful return so the spreadsheet card can open itself', async () => {
    let seen: boolean | null = null;
    function Reporter() {
      seen = useGoogleReturnNotice('es');
      return null;
    }
    window.history.replaceState(null, '', '/admin/forms/f1/edit?tab=connect&google=connected');
    const el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => root!.render(<Reporter />));
    // Still true after the flag has been stripped from the address.
    expect(window.location.search).toBe('?tab=connect');
    expect(seen).toBe(true);
  });
});

describe('the flag stays gone', () => {
  // Next syncs its router to a replaceState only when the state is not its
  // own. Handing its state back kept `?google=connected` as the canonical
  // URL, and the next server action (connecting Salesforce on the same tab)
  // wrote it back into the address, so a reload announced it again.
  it('strips the flag with a null state, so the router adopts the clean URL', async () => {
    window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: [] }, '', '/admin/forms/f1/edit?tab=connect&google=connected');
    const spy = vi.spyOn(window.history, 'replaceState');
    const el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => root!.render(<Probe />));
    expect(spy).toHaveBeenCalledWith(null, '', expect.anything());
    expect(String(spy.mock.calls.at(-1)![2])).not.toContain('google=');
    spy.mockRestore();
  });
});
