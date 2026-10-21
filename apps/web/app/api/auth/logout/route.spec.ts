import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getSession = vi.fn();
const clearSession = vi.fn();
const revokeUpstreamSession = vi.fn();
vi.mock('@/lib/auth-session', async () => {
  // idpLogoutTarget is pure; the real one runs so the tests exercise the actual
  // return_to construction instead of a mirror of it.
  const actual = await vi.importActual<typeof import('@/lib/auth-session')>('@/lib/auth-session');
  return {
    idpLogoutTarget: actual.idpLogoutTarget,
    getSession: (...a: unknown[]) => getSession(...a),
    clearSession: (...a: unknown[]) => clearSession(...a),
    revokeUpstreamSession: (...a: unknown[]) => revokeUpstreamSession(...a),
  };
});

import { GET } from './route';

const req = (path = '/api/auth/logout') => new NextRequest(`https://forms.example.com${path}`);
const workosSession = { provider: 'workos', accessToken: 'tok', sessionId: 'session_123' };

describe('GET /api/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PUBLIC_APP_URL', '');
    revokeUpstreamSession.mockResolvedValue(null);
  });

  it('never follows the IdP logout URL (Orbit contract, skipIdpRedirect = true)', async () => {
    getSession.mockResolvedValue(workosSession);
    revokeUpstreamSession.mockResolvedValue('https://api.workos.com/user_management/sessions/logout?session_id=session_123');

    const res = await GET(req());

    expect(res.headers.get('location')).toBe('https://forms.example.com/login?signedout=1');
    // Read-then-clear: the revoke needs the session id the cookie carried.
    expect(getSession.mock.invocationCallOrder[0]).toBeLessThan(clearSession.mock.invocationCallOrder[0]!);
    expect(revokeUpstreamSession).toHaveBeenCalledWith(workosSession);
    expect(clearSession).toHaveBeenCalled();
  });

  it('reason=expired behaves identically: revoke, clear, local landing', async () => {
    getSession.mockResolvedValue(workosSession);
    revokeUpstreamSession.mockResolvedValue('https://api.workos.com/user_management/sessions/logout?session_id=session_123');

    const res = await GET(req('/api/auth/logout?reason=expired'));

    expect(revokeUpstreamSession).toHaveBeenCalledWith(workosSession);
    expect(clearSession).toHaveBeenCalled();
    expect(res.headers.get('location')).toBe('https://forms.example.com/login?signedout=1');
  });

  it('lands locally when the IAM hands back no logout URL', async () => {
    getSession.mockResolvedValue(workosSession);

    const res = await GET(req());

    expect(clearSession).toHaveBeenCalled();
    expect(res.headers.get('location')).toBe('https://forms.example.com/login?signedout=1');
  });

  it('cleans up and lands locally when there is no session at all', async () => {
    getSession.mockResolvedValue(null);

    const res = await GET(req());

    expect(clearSession).toHaveBeenCalled();
    expect(revokeUpstreamSession).toHaveBeenCalledWith(null);
    expect(res.headers.get('location')).toBe('https://forms.example.com/login?signedout=1');
  });
});

/**
 * An old domain still serving after a move. The pod sees its own listen
 * address; the public host only exists in the headers.
 */
describe('GET /api/auth/logout on a host other than PUBLIC_APP_URL', () => {
  const at = (host: string, path = '/api/auth/logout') =>
    GET(new NextRequest(`http://0.0.0.0:3000${path}`, { headers: { host } }));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PUBLIC_APP_URL', 'https://app.example.com');
    revokeUpstreamSession.mockResolvedValue(null);
    getSession.mockResolvedValue(workosSession);
  });

  it('clears that host\'s cookie and lands on that host, never on PUBLIC_APP_URL', async () => {
    const res = await at('forms.example.org', '/api/auth/logout?reason=expired');

    expect(clearSession).toHaveBeenCalled();
    // Relative: the browser resolves it against the host it asked; no header
    // is trusted to build it.
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/login?signedout=1');
  });

  it('a forged X-Forwarded-Host gets the same relative landing, never a header value', async () => {
    const res = await GET(
      new NextRequest('http://0.0.0.0:3000/api/auth/logout', {
        headers: { 'x-forwarded-host': 'evil.example.net', host: 'app.example.com' },
      }),
    );

    expect(res.headers.get('location')).toBe('/login?signedout=1');
  });

  it('on the PUBLIC_APP_URL host: the landing is unchanged', async () => {
    const res = await at('app.example.com');

    expect(res.headers.get('location')).toBe('https://app.example.com/login?signedout=1');
  });
});
