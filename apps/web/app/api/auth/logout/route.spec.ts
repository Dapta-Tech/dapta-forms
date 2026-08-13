import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getSession = vi.fn();
const clearSession = vi.fn();
vi.mock('@/lib/auth-session', () => ({
  getSession: (...a: unknown[]) => getSession(...a),
  clearSession: (...a: unknown[]) => clearSession(...a),
}));

import { GET } from './route';

const req = () => new NextRequest('https://forms.example.com/api/auth/logout');
const workosSession = { provider: 'workos', accessToken: 'tok', sessionId: 'sess_123' };

describe('GET /api/auth/logout', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('IAM_BASE_URL', 'https://iam.example.com/iam');
    vi.stubEnv('PUBLIC_APP_URL', '');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('appends return_to to the IAM logoutUrl so WorkOS sends the browser back', async () => {
    getSession.mockResolvedValue(workosSession);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ logoutUrl: 'https://api.workos.com/user_management/sessions/logout?session_id=sess_123' }),
    });

    const res = await GET(req());

    const target = new URL(res.headers.get('location')!);
    expect(target.origin + target.pathname).toBe('https://api.workos.com/user_management/sessions/logout');
    expect(target.searchParams.get('session_id')).toBe('sess_123');
    expect(target.searchParams.get('return_to')).toBe('https://forms.example.com/login?signedout=1');
    // The session id travels to the IAM, and the cookie is cleared after reading it.
    expect(fetchMock).toHaveBeenCalledWith(
      'https://iam.example.com/iam/auth/logout',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ workos_session_id: 'sess_123' }) }),
    );
    expect(clearSession).toHaveBeenCalled();
  });

  it('keeps a preexisting return_to out of the way by overwriting it', async () => {
    getSession.mockResolvedValue(workosSession);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        logoutUrl: 'https://api.workos.com/user_management/sessions/logout?session_id=s&return_to=https%3A%2F%2Felsewhere.example',
      }),
    });

    const res = await GET(req());

    const target = new URL(res.headers.get('location')!);
    expect(target.searchParams.get('return_to')).toBe('https://forms.example.com/login?signedout=1');
  });

  it('lands locally on an unparseable logoutUrl instead of failing the sign-out', async () => {
    getSession.mockResolvedValue(workosSession);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ logoutUrl: '/relative-not-a-url' }) });

    const res = await GET(req());

    expect(res.headers.get('location')).toBe('https://forms.example.com/login?signedout=1');
  });

  it('falls back to /login?signedout=1 when the IAM call fails', async () => {
    getSession.mockResolvedValue(workosSession);
    fetchMock.mockResolvedValue({ ok: false });

    const res = await GET(req());

    expect(res.headers.get('location')).toBe('https://forms.example.com/login?signedout=1');
  });

  it('skips the IAM entirely without a workos session id', async () => {
    getSession.mockResolvedValue({ provider: 'local', email: 'a@b.c' });

    const res = await GET(req());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe('https://forms.example.com/login?signedout=1');
  });
});
