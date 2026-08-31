import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getSession = vi.fn();
const setSession = vi.fn();
const refreshUpstreamSession = vi.fn();
vi.mock('@/lib/auth-session', () => ({
  getSession: (...a: unknown[]) => getSession(...a),
  setSession: (...a: unknown[]) => setSession(...a),
  refreshUpstreamSession: (...a: unknown[]) => refreshUpstreamSession(...a),
}));

import { GET } from './route';

const req = () => new NextRequest('https://forms.example.com/api/auth/refresh');
const staleSession = { provider: 'workos', accessToken: 'old', refreshToken: 'refresh-1' };
const freshSession = { provider: 'workos', accessToken: 'new', refreshToken: 'refresh-2' };

describe('GET /api/auth/refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PUBLIC_APP_URL', '');
    getSession.mockResolvedValue(staleSession);
  });

  it('stores the refreshed session and returns to /admin', async () => {
    refreshUpstreamSession.mockResolvedValue(freshSession);

    const res = await GET(req());

    expect(refreshUpstreamSession).toHaveBeenCalledWith(staleSession);
    expect(setSession).toHaveBeenCalledWith(freshSession);
    expect(res.headers.get('location')).toBe('https://forms.example.com/admin');
  });

  it('hands off to the logout route when the refresh fails, without touching the cookie', async () => {
    refreshUpstreamSession.mockResolvedValue(null);

    const res = await GET(req());

    expect(setSession).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe(
      'https://forms.example.com/api/auth/logout?reason=expired',
    );
  });

  it('hands off to the logout route when there is no session at all', async () => {
    getSession.mockResolvedValue(null);
    refreshUpstreamSession.mockResolvedValue(null);

    const res = await GET(req());

    expect(res.headers.get('location')).toBe(
      'https://forms.example.com/api/auth/logout?reason=expired',
    );
  });
});
