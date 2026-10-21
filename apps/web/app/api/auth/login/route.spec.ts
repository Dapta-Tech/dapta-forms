import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const cookieJar = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
const provider = vi.hoisted(() => ({ name: 'workos' }));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => cookieJar) }));
vi.mock('@/lib/auth-session', () => ({ authProvider: () => provider.name }));

import { GET } from './route';

const AUTHORIZE =
  'https://api.workos.com/user_management/authorize?client_id=client_1&provider=authkit&state=abc';

const req = (path: string) => new NextRequest(`https://forms.example.com${path}`);

describe('GET /api/auth/login prompt handling', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    provider.name = 'workos';
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('PUBLIC_APP_URL', '');
    vi.stubEnv('IAM_BASE_URL', 'https://iam.example.com/iam');
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ loginUrl: AUTHORIZE }) });
    cookieJar.get.mockReturnValue(undefined);
  });

  it('patches prompt=login onto the authorize URL when asked (the IAM drops the param)', async () => {
    const res = await GET(req('/api/auth/login?prompt=login'));

    const target = new URL(res.headers.get('location')!);
    expect(target.origin + target.pathname).toBe('https://api.workos.com/user_management/authorize');
    expect(target.searchParams.get('prompt')).toBe('login');
    // Forwarded to the IAM too, so nothing changes here the day it propagates it.
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('prompt=login');
  });

  it('sends no prompt on the bare auto-redirect (silent SSO stays)', async () => {
    const res = await GET(req('/api/auth/login'));

    expect(new URL(res.headers.get('location')!).searchParams.get('prompt')).toBeNull();
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('prompt');
  });

  it('ignores any prompt value that is not exactly login', async () => {
    const res = await GET(req('/api/auth/login?prompt=evil%20login'));

    expect(new URL(res.headers.get('location')!).searchParams.get('prompt')).toBeNull();
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('prompt');
  });
});

/**
 * The old-host hop (a domain move where the old host keeps serving). The state
 * cookie is host-only and `returnTo` is always the PUBLIC_APP_URL callback, so a
 * login started on any other hostname is a guaranteed /login?error=state unless
 * it first moves to the canonical host, with nothing written on the old one.
 *
 * Requests use the pod-internal URL the standalone server really sees behind the
 * proxy; the public host only exists in the headers.
 */
describe('GET /api/auth/login on a host other than PUBLIC_APP_URL', () => {
  const fetchMock = vi.fn();
  const CANONICAL = 'https://app.example.com';
  // Repeated keys, an empty value, a bare key, `+` next to `%20` and an encoded
  // `next`: everything a re-serialization by this route would quietly change.
  // (Next itself normalizes the encoding before any handler runs; the hop must
  // not add a second, different pass on top.)
  const QUERY =
    '?utm_source=news&utm_source=ads&utm_campaign=spring%20launch&ph_id=0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' +
    '&next=%2Fadmin%2Fforms%3Ftab%3Dall&q=a+b&empty=&bare&prompt=login';

  const at = (headers: Record<string, string>, pathAndQuery = `/api/auth/login${QUERY}`) =>
    GET(new NextRequest(`https://0.0.0.0:3000${pathAndQuery}`, { headers }));

  const expectNoHop = (res: Response) => {
    expect(res.status).not.toBe(302);
    expect(new URL(res.headers.get('location')!).origin).toBe('https://api.workos.com');
    expect(cookieJar.set).toHaveBeenCalledWith('quill_oauth_state', expect.any(String), expect.any(Object));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    provider.name = 'workos';
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('PUBLIC_APP_URL', CANONICAL);
    vi.stubEnv('IAM_BASE_URL', 'https://iam.example.com/iam');
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ loginUrl: AUTHORIZE }) });
    cookieJar.get.mockReturnValue(undefined);
  });

  it('on the PUBLIC_APP_URL host: no hop, every cookie set, canonical returnTo', async () => {
    const res = await at({ host: 'app.example.com' });

    expectNoHop(res);
    const names = cookieJar.set.mock.calls.map(([name]) => name);
    expect(names).toEqual(['quill_oauth_state', 'quill_attribution', 'quill_ph_id']);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `returnTo=${encodeURIComponent(`${CANONICAL}/api/auth/callback`)}`,
    );
  });

  it('on another host: 302 to the same path and query on PUBLIC_APP_URL, no cookie', async () => {
    const res = await at({ host: 'forms.example.org' });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${CANONICAL}/api/auth/login${QUERY}`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(cookieJar.set).not.toHaveBeenCalled();
    // Nothing is asked of the IAM either: the login starts over on the right host.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a bare hop bare (no query invented)', async () => {
    const res = await at({ host: 'forms.example.org' }, '/api/auth/login');

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${CANONICAL}/api/auth/login`);
  });

  it('compares hostnames case-insensitively, on both sides', async () => {
    expectNoHop(await at({ host: 'APP.Example.COM' }));

    vi.stubEnv('PUBLIC_APP_URL', 'https://App.EXAMPLE.com');
    cookieJar.set.mockClear();
    expectNoHop(await at({ host: 'app.example.com' }));
  });

  it('ignores the port: cookies are not isolated by port, and a proxy may spell out :443', async () => {
    expectNoHop(await at({ host: 'app.example.com:443' }));
    cookieJar.set.mockClear();
    expectNoHop(await at({ host: 'app.example.com:8443' }));
  });

  it('reads X-Forwarded-Host before Host, the order Next checks Server Actions in', async () => {
    // Behind a proxy that forwards the public host as X-Forwarded-Host and sends
    // its own upstream name as Host.
    expectNoHop(await at({ 'x-forwarded-host': 'app.example.com', host: 'web:3000' }));

    const res = await at({ 'x-forwarded-host': 'forms.example.org', host: 'web:3000' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${CANONICAL}/api/auth/login${QUERY}`);
  });

  it('takes the first hop of a chained X-Forwarded-Host', async () => {
    expectNoHop(await at({ 'x-forwarded-host': 'app.example.com, proxy.internal', host: 'web:3000' }));

    const res = await at({ 'x-forwarded-host': 'forms.example.org, app.example.com', host: 'app.example.com' });
    expect(res.status).toBe(302);
  });

  it('a forged X-Forwarded-Host can only send its sender to PUBLIC_APP_URL, never elsewhere', async () => {
    const res = await at({ 'x-forwarded-host': 'evil.example.net', host: 'app.example.com' });

    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location')!).origin).toBe(CANONICAL);
  });

  it('does not hop when no host can be read, or it does not parse', async () => {
    expectNoHop(await at({}));
    cookieJar.set.mockClear();
    expectNoHop(await at({ host: 'not a host' }));
  });

  it('without PUBLIC_APP_URL (self-host dev): no hop on any host, behavior unchanged', async () => {
    for (const value of ['', '   ']) {
      vi.stubEnv('PUBLIC_APP_URL', value);
      cookieJar.set.mockClear();
      fetchMock.mockClear();
      const res = await at({ host: 'forms.example.org', 'x-forwarded-proto': 'https' });

      expectNoHop(res);
      // The returnTo still follows the request host, exactly as before.
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
        `returnTo=${encodeURIComponent('https://forms.example.org/api/auth/callback')}`,
      );
    }
  });

  it('with an unparseable PUBLIC_APP_URL: no hop (a bad env var never breaks the auth path)', async () => {
    vi.stubEnv('PUBLIC_APP_URL', 'not a url');

    expectNoHop(await at({ host: 'forms.example.org', 'x-forwarded-proto': 'https' }));
  });

  it('leaves the vendor-clean bounce of a non-WorkOS build as it was', async () => {
    provider.name = 'local';

    const res = await at({ host: 'forms.example.org' });

    expect(res.headers.get('location')).toBe(`${CANONICAL}/login`);
    expect(cookieJar.set).not.toHaveBeenCalled();
  });
});
