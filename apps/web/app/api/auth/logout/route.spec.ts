import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getSession = vi.fn();
const clearSession = vi.fn();
const revokeUpstreamSession = vi.fn();
vi.mock('@/lib/auth-session', () => ({
  getSession: (...a: unknown[]) => getSession(...a),
  clearSession: (...a: unknown[]) => clearSession(...a),
  revokeUpstreamSession: (...a: unknown[]) => revokeUpstreamSession(...a),
}));

import { GET } from './route';

const req = () => new NextRequest('https://forms.example.com/api/auth/logout');
const workosSession = { provider: 'workos', accessToken: 'tok', sessionId: 'sess_123' };

describe('GET /api/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PUBLIC_APP_URL', '');
    revokeUpstreamSession.mockResolvedValue(undefined);
  });

  it('reads the session, clears the cookie, revokes upstream, lands locally', async () => {
    getSession.mockResolvedValue(workosSession);

    const res = await GET(req());

    // Read-then-clear: the revoke needs the session id the cookie carried.
    expect(getSession.mock.invocationCallOrder[0]).toBeLessThan(clearSession.mock.invocationCallOrder[0]!);
    expect(revokeUpstreamSession).toHaveBeenCalledWith(workosSession);
    expect(clearSession).toHaveBeenCalled();
    // Never WorkOS — the browser stays on our origin (skipIdpRedirect contract).
    expect(res.headers.get('location')).toBe('https://forms.example.com/login?signedout=1');
  });

  it('cleans up and lands locally even when there is no session at all', async () => {
    getSession.mockResolvedValue(null);

    const res = await GET(req());

    expect(clearSession).toHaveBeenCalled();
    expect(revokeUpstreamSession).toHaveBeenCalledWith(null);
    expect(res.headers.get('location')).toBe('https://forms.example.com/login?signedout=1');
  });
});
