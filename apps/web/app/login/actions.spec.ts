import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn();
const clearSession = vi.fn();
const revokeUpstreamSession = vi.fn();
const setSession = vi.fn();
const authProvider = vi.fn();
vi.mock('@/lib/auth-session', () => ({
  getSession: (...a: unknown[]) => getSession(...a),
  clearSession: (...a: unknown[]) => clearSession(...a),
  revokeUpstreamSession: (...a: unknown[]) => revokeUpstreamSession(...a),
  setSession: (...a: unknown[]) => setSession(...a),
  authProvider: () => authProvider(),
}));

const redirect = vi.fn((url: string) => {
  // Mirror Next's real behavior: redirect() throws, ending the action.
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }));

import { signOutAction } from './actions';

const workosSession = { provider: 'workos', accessToken: 'tok', sessionId: 'sess_123' };

describe('signOutAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('workos: reads the session before clearing, revokes upstream, lands on /login?signedout=1', async () => {
    authProvider.mockReturnValue('workos');
    getSession.mockResolvedValue(workosSession);

    await expect(signOutAction()).rejects.toThrow('NEXT_REDIRECT:/login?signedout=1');

    // Read-then-clear: clearing first hands the revoke a null session (the
    // pre-#82 bug that left the upstream WorkOS session alive).
    expect(getSession.mock.invocationCallOrder[0]).toBeLessThan(clearSession.mock.invocationCallOrder[0]!);
    expect(revokeUpstreamSession).toHaveBeenCalledWith(workosSession);
    expect(clearSession).toHaveBeenCalled();
  });

  it('workos: still clears and lands locally when the session is already gone', async () => {
    authProvider.mockReturnValue('workos');
    getSession.mockResolvedValue(null);

    await expect(signOutAction()).rejects.toThrow('NEXT_REDIRECT:/login?signedout=1');

    expect(clearSession).toHaveBeenCalled();
    expect(revokeUpstreamSession).toHaveBeenCalledWith(null);
  });

  it('local: clears and lands on plain /login without touching the IAM helper contract', async () => {
    authProvider.mockReturnValue('local');
    getSession.mockResolvedValue({ provider: 'local', email: 'a@b.c' });

    await expect(signOutAction()).rejects.toThrow('NEXT_REDIRECT:/login');

    expect(clearSession).toHaveBeenCalled();
  });
});
