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
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) }),
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

/**
 * `?next=` is honored for the playbooks only: their links arrive by email and
 * ask for a download that landing on /admin would lose.
 */
describe('GET /api/auth/refresh with a destination', () => {
  const ORIGIN = 'https://forms.example.com';
  const PLAYBOOK = '/admin/playbooks/guia?lang=en&pdf=1';
  const withNext = (next: string) => new NextRequest(`${ORIGIN}/api/auth/refresh?next=${encodeURIComponent(next)}`);
  const location = async (next: string) => (await GET(withNext(next))).headers.get('location');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PUBLIC_APP_URL', '');
    jar.clear();
    getSession.mockResolvedValue(staleSession);
    refreshUpstreamSession.mockResolvedValue(freshSession);
  });

  it.each([PLAYBOOK, '/admin/playbooks/guia', '/admin/playbooks'])('returns a refreshed session to %s', async (next) => {
    expect(await location(next)).toBe(`${ORIGIN}${next}`);
    expect(setSession).toHaveBeenCalledWith(freshSession);
  });

  it.each([
    'https://evil.example',
    'https://evil.example/admin/playbooks/guia',
    '//evil.example',
    '//evil.example/admin/playbooks',
    '/\\evil.example',
    '/login',
    '/admin/forms',
    '/admin/developers/keys',
    '/admin/playbooks/../../login',
    '/admin/playbooks/guia?lang=en&pdf=1&x=1',
    '/admin/playbooks/guia\nSet-Cookie: a=b',
  ])('ignores %j and lands on /admin as before', async (next) => {
    expect(await location(next)).toBe(`${ORIGIN}/admin`);
  });

  it.each(['https://evil.example', '/admin/forms'])('ignores %s when the refresh fails too', async (next) => {
    refreshUpstreamSession.mockResolvedValue(null);
    expect(await location(next)).toBe(`${ORIGIN}/api/auth/logout?reason=expired`);
    getSession.mockResolvedValue(null);
    expect(await location(next)).toBe(`${ORIGIN}/api/auth/logout?reason=expired`);
  });

  it('keeps the playbook through the sign-out of a session that cannot be refreshed', async () => {
    refreshUpstreamSession.mockResolvedValue(null);
    expect(await location(PLAYBOOK)).toBe(`${ORIGIN}/api/auth/logout?reason=expired&next=${encodeURIComponent(PLAYBOOK)}`);
    expect(setSession).not.toHaveBeenCalled();
  });

  it('sends someone with no session at all to the hosted login, which comes back to the playbook', async () => {
    getSession.mockResolvedValue(null);
    refreshUpstreamSession.mockResolvedValue(null);
    expect(await location(PLAYBOOK)).toBe(`${ORIGIN}/api/auth/login?next=${encodeURIComponent(PLAYBOOK)}`);
  });

  it('does not send them there twice: the destination already parked means the login was just tried', async () => {
    getSession.mockResolvedValue(null);
    refreshUpstreamSession.mockResolvedValue(null);
    jar.set('quill_next', PLAYBOOK);
    expect(await location(PLAYBOOK)).toBe(`${ORIGIN}/api/auth/logout?reason=expired&next=${encodeURIComponent(PLAYBOOK)}`);
  });
});
