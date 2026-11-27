import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const cookieJar = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
const provider = vi.hoisted(() => ({ name: 'workos' }));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => cookieJar) }));
vi.mock('@/lib/auth-session', () => ({ authProvider: () => provider.name }));
// `after` captured, never run: the send itself is lib/login-started.spec.ts's.
// A plain function, not a `vi.fn`, so a task can be inspected without running it.
const nextAfter = vi.hoisted(() => ({ tasks: [] as Array<() => unknown> }));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => {
    nextAfter.tasks.push(task);
  },
}));
const recordLoginStarted = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/login-started', () => ({ recordLoginStarted }));

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
    expect(names).toEqual(['quill_oauth_state', 'dforms_bid', 'quill_attribution', 'quill_ph_id']);
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

/**
 * `?screen=sign-up` (lib/login-screen.ts): a landing's "create an account"
 * call to action, passed on by the root page, asks the identity service for
 * its sign-up screen. The identity service call is asserted as a whole string,
 * so "without the flag" means byte for byte the request this route has always
 * sent, and "with it" means that same request plus one trailing parameter.
 */
describe('GET /api/auth/login sign-up screen', () => {
  const fetchMock = vi.fn();
  const iamCall = () => String(fetchMock.mock.calls[0]?.[0]);
  const cookieSet = (name: string) => cookieJar.set.mock.calls.find((c) => c[0] === name);
  /** The identity service request this route sent before the flag existed, plus `extra`. */
  const iamUrl = (origin: string, extra = '') =>
    'https://iam.example.com/iam/auth/login-url' +
    `?returnTo=${encodeURIComponent(`${origin}/api/auth/callback`)}` +
    `&state=${encodeURIComponent(String(cookieSet('quill_oauth_state')?.[1]))}` +
    extra;

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

  it('asks the identity service for the sign-up screen', async () => {
    const res = await GET(req('/api/auth/login?screen=sign-up'));

    expect(iamCall()).toBe(iamUrl('https://forms.example.com', '&screenHint=sign-up'));
    // The identity service puts the hint on the authorize URL itself, so its
    // answer is followed untouched.
    expect(res.headers.get('location')).toBe(AUTHORIZE);
  });

  it('sends exactly the request it always sent without it', async () => {
    const res = await GET(req('/api/auth/login'));

    expect(iamCall()).toBe(iamUrl('https://forms.example.com'));
    expect(res.headers.get('location')).toBe(AUTHORIZE);
  });

  it.each([
    'screen=signup',
    'screen=Sign-Up',
    'screen=sign-in',
    'screen=',
    'screen',
    'screen=sign-up%20',
    'screen=%20sign-up',
    // The decoded value is `sign-up&prompt=none`: never spliced onto the request.
    'screen=sign-up%26prompt%3Dnone',
    // A repeated parameter is not a choice, in either order, as on the root page.
    'screen=evil&screen=sign-up',
    'screen=sign-up&screen=evil',
    'screen=sign-up&screen=sign-up',
    // The identity service's own names are not this route's parameter.
    'screenHint=sign-up',
    'screen_hint=sign-up',
  ])('ignores anything but exactly screen=sign-up (%s)', async (query) => {
    const res = await GET(req(`/api/auth/login?${query}`));

    expect(iamCall()).toBe(iamUrl('https://forms.example.com'));
    expect(res.headers.get('location')).toBe(AUTHORIZE);
  });

  it('keeps prompt=login beside it, patched onto the answer as before', async () => {
    const res = await GET(req('/api/auth/login?screen=sign-up&prompt=login'));

    expect(iamCall()).toBe(iamUrl('https://forms.example.com', '&prompt=login&screenHint=sign-up'));
    expect(new URL(res.headers.get('location')!).searchParams.get('prompt')).toBe('login');
  });

  it('parks the campaign tags and the landing id the root forwarded beside it, exactly as without it', async () => {
    const tags = 'utm_source=dforms&utm_campaign=nov&ph_id=0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

    await GET(req(`/api/auth/login?${tags}`));
    const without = cookieJar.set.mock.calls.filter(([name]) => name !== 'quill_oauth_state' && name !== 'dforms_bid');
    cookieJar.set.mockClear();
    fetchMock.mockClear();
    await GET(req(`/api/auth/login?${tags}&screen=sign-up`));
    const withIt = cookieJar.set.mock.calls.filter(([name]) => name !== 'quill_oauth_state' && name !== 'dforms_bid');

    expect(withIt).toEqual(without);
    expect(withIt.map(([name]) => name)).toEqual(['quill_attribution', 'quill_ph_id']);
    expect(JSON.parse(String(cookieSet('quill_attribution')?.[1]))).toEqual({ utmSource: 'dforms', utmCampaign: 'nov' });
    expect(iamCall()).toBe(iamUrl('https://forms.example.com', '&screenHint=sign-up'));
  });

  it('is not a campaign tag: the flag alone parks no attribution', async () => {
    await GET(req('/api/auth/login?screen=sign-up'));

    expect(cookieJar.set.mock.calls.map(([name]) => name)).toEqual(['quill_oauth_state', 'dforms_bid']);
  });

  it.each([
    ['with it', '?screen=sign-up', '&screenHint=sign-up'],
    ['without it', '', ''],
  ])('returns to the public origin behind the proxy, %s', async (_label, query, extra) => {
    // Behind the load balancer `req.url` is the bind address; the callback is
    // built from the forwarded headers, as it always was.
    const proxied = new NextRequest(`https://0.0.0.0:3000/api/auth/login${query}`, {
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'app.example.org, internal.example' },
    });

    await GET(proxied);

    expect(iamCall()).toBe(iamUrl('https://app.example.org', extra));
  });

  it('keeps it through the old-host hop, so the login that starts on PUBLIC_APP_URL still asks for sign-up', async () => {
    vi.stubEnv('PUBLIC_APP_URL', 'https://app.example.com');
    const query = '?utm_source=dforms&screen=sign-up';

    const res = await GET(new NextRequest(`https://0.0.0.0:3000/api/auth/login${query}`, { headers: { host: 'forms.example.org' } }));

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`https://app.example.com/api/auth/login${query}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parks the same state cookie, the login-CSRF guard the callback checks', async () => {
    await GET(req('/api/auth/login?screen=sign-up'));

    expect(cookieSet('quill_oauth_state')?.[1]).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(cookieSet('quill_oauth_state')?.[2]).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600 });
  });

  it('lands on the same error card when the identity service fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });

    const res = await GET(req('/api/auth/login?screen=sign-up'));

    expect(res.headers.get('location')).toBe('https://forms.example.com/login?error=login');
  });

  it('the local provider has no hosted screen to pick: the login form, as before', async () => {
    provider.name = 'local';

    const res = await GET(req('/api/auth/login?screen=sign-up'));

    expect(res.headers.get('location')).toBe('https://forms.example.com/login');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/auth/login records the start (forms_login_started)', () => {
  const fetchMock = vi.fn();
  const LANDING_ID = '0192f0a4-7c1e-7d2b-9a3c-5e6f7a8b9c0d';
  const UA = 'Mozilla/5.0 Test';
  const get = (path: string) => GET(new NextRequest(`https://forms.example.com${path}`, { headers: { 'user-agent': UA } }));
  /** Run what the route handed to `after`, as Next would once the response is out. */
  const flush = async () => {
    for (const task of nextAfter.tasks.splice(0)) await task();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    nextAfter.tasks = [];
    provider.name = 'workos';
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('PUBLIC_APP_URL', '');
    vi.stubEnv('IAM_BASE_URL', 'https://iam.example.com/iam');
    vi.stubEnv('NEXT_PUBLIC_PRODUCT_ANALYTICS_KEY', 'phc_test');
    vi.stubEnv('NEXT_PUBLIC_PRODUCT_ANALYTICS_HOST', 'https://ingest.example.test');
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ loginUrl: AUTHORIZE }) });
    cookieJar.get.mockReturnValue(undefined);
  });

  it('sends the sign-up start after the redirect, with the landing id and source of this attempt', async () => {
    const res = await get(`/api/auth/login?utm_source=linkedin&ph_id=${LANDING_ID}&screen=sign-up`);

    expect(res.headers.get('location')).toBe(AUTHORIZE);
    // Scheduled, not sent: nothing waits on it.
    expect(recordLoginStarted).not.toHaveBeenCalled();
    await flush();
    expect(recordLoginStarted).toHaveBeenCalledWith(
      {
        screen: 'sign-up',
        landingId: LANDING_ID,
        utmSource: 'linkedin',
        origin: 'https://forms.example.com',
        userAgent: UA,
        at: expect.any(Date),
      },
      // No PUBLIC_APP_URL in this suite, so the deployment reads as local.
      { key: 'phc_test', host: 'https://ingest.example.test', environment: 'local' },
    );
  });

  it('a parked attempt wins over the arriving one, as for the cookies', async () => {
    cookieJar.get.mockImplementation((name: string) =>
      name === 'quill_ph_id'
        ? { value: 'parked-id' }
        : name === 'quill_attribution'
          ? { value: JSON.stringify({ utmSource: 'google' }) }
          : undefined,
    );

    await get(`/api/auth/login?utm_source=linkedin&ph_id=${LANDING_ID}&prompt=login`);
    await flush();

    expect(recordLoginStarted).toHaveBeenCalledWith(
      expect.objectContaining({ screen: 'sign-in', landingId: 'parked-id', utmSource: 'google' }),
      expect.anything(),
    );
  });

  it('a parked blob without a source is still the parked attempt: no later source stands in', async () => {
    cookieJar.get.mockImplementation((name: string) =>
      name === 'quill_attribution' ? { value: JSON.stringify({ referrer: 'https://news.example/' }) } : undefined,
    );

    await get('/api/auth/login?utm_source=linkedin&screen=sign-up');
    await flush();

    expect(recordLoginStarted).toHaveBeenCalledWith(expect.objectContaining({ utmSource: null }), expect.anything());
  });

  it('records nothing with analytics off, or when the login never reaches the hosted screen', async () => {
    vi.stubEnv('NEXT_PUBLIC_PRODUCT_ANALYTICS_KEY', '');
    await get('/api/auth/login?screen=sign-up');
    vi.stubEnv('NEXT_PUBLIC_PRODUCT_ANALYTICS_KEY', 'phc_test');
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    await get('/api/auth/login?screen=sign-up');
    provider.name = 'local';
    await get('/api/auth/login?screen=sign-up');

    expect(nextAfter.tasks).toHaveLength(0);
  });
});

/**
 * The referral code parks in the attribution cookie like the UTMs: same
 * cookie, same lifetime, same first-attempt-wins rule. The callback is its
 * only reader.
 */
describe('GET /api/auth/login parks ref in the attribution cookie', () => {
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

  const parked = () => {
    const call = cookieJar.set.mock.calls.find(([name]) => name === 'quill_attribution');
    return call ? { value: JSON.parse(call[1] as string), options: call[2] } : null;
  };

  it('a referral link alone sets the cookie, httpOnly and for the login attempt only', async () => {
    await GET(req('/api/auth/login?ref=k7m2p9qx'));
    expect(parked()).toEqual({
      value: { referralCode: 'k7m2p9qx' },
      options: expect.objectContaining({ httpOnly: true, maxAge: 600 }),
    });
  });

  it('rides beside the campaign tags', async () => {
    await GET(req('/api/auth/login?ref=k7m2p9qx&utm_source=whatsapp'));
    expect(parked()?.value).toEqual({ referralCode: 'k7m2p9qx', utmSource: 'whatsapp' });
  });

  it('an attempt already parked keeps its own: the first link wins', async () => {
    cookieJar.get.mockImplementation((name: string) =>
      name === 'quill_attribution' ? { value: JSON.stringify({ referralCode: 'first111' }) } : undefined,
    );
    await GET(req('/api/auth/login?ref=second22'));
    expect(parked()).toBeNull();
  });
});

/**
 * The first-party browser id (lib/browser-id.ts): minted on a login hit when
 * the browser has none, so the callback can hand it to the referral claim, and
 * never replaced when it has one.
 */
describe('GET /api/auth/login, the browser id', () => {
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

  it('mints a long-lived httpOnly dforms_bid when the browser has none', async () => {
    await GET(req('/api/auth/login'));

    const set = cookieJar.set.mock.calls.find(([name]) => name === 'dforms_bid');
    expect(set).toBeDefined();
    expect(set![1]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(set![2]).toMatchObject({ path: '/', httpOnly: true, sameSite: 'lax', maxAge: 2 * 365 * 24 * 60 * 60 });
  });

  it('keeps the one the browser already has', async () => {
    const existing = 'A'.repeat(43);
    cookieJar.get.mockImplementation((name: string) => (name === 'dforms_bid' ? { value: existing } : undefined));

    await GET(req('/api/auth/login'));

    expect(cookieJar.set.mock.calls.map(([name]) => name)).not.toContain('dforms_bid');
  });
});

/**
 * `?next=` (lib/return-path.ts): a dashboard path parked for the callback.
 * Unlike the tags the latest attempt wins, and a login that asks for no
 * destination clears an old one.
 */
describe('GET /api/auth/login destination (next)', () => {
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

  const nextSet = () => cookieJar.set.mock.calls.find(([name]) => name === 'quill_next');

  it.each([
    '/admin/developers/keys',
    '/admin/developers/docs',
    '/admin/playbooks',
    '/admin/playbooks/guia-de-calificacion',
    '/admin/playbooks/x?lang=en',
  ])('parks %s in an httpOnly cookie for 30 minutes', async (next) => {
    await GET(req(`/api/auth/login?next=${encodeURIComponent(next)}`));

    expect(nextSet()?.[1]).toBe(next);
    expect(nextSet()?.[2]).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 1800 });
  });

  it.each([
    ['another host', 'https://evil.example'],
    ['a protocol-relative URL', '//evil.example/admin'],
    ['a parent segment', '/admin/playbooks/../../login'],
    ['a query string', '/admin/playbooks?categoria=ventas'],
    ['a path outside the dashboard', '/playbooks/guia'],
    ['an overlong path', `/admin/playbooks/${'a'.repeat(200)}`],
    ['a language plus another parameter', '/admin/playbooks/x?lang=en&x=1'],
    ['a language the reader does not have', '/admin/playbooks/x?lang=fr'],
  ])('never parks %s', async (_label, next) => {
    await GET(req(`/api/auth/login?next=${encodeURIComponent(next)}`));

    expect(nextSet()).toBeUndefined();
  });

  it.each([
    ['a language plus an encoded parameter', '/admin/playbooks/x?lang=en%26x=1'],
    ['a language the reader does not have', '/admin/playbooks/x?lang=fr'],
  ])('never parks %s written straight into the link', async (_label, raw) => {
    await GET(req(`/api/auth/login?next=${raw}`));

    expect(nextSet()).toBeUndefined();
  });

  it('the latest attempt wins over an older parked destination', async () => {
    cookieJar.get.mockImplementation((name: string) =>
      name === 'quill_next' ? { value: '/admin/developers/keys' } : undefined,
    );

    await GET(req('/api/auth/login?next=%2Fadmin%2Fplaybooks%2Fguia-de-calificacion'));

    expect(nextSet()?.[1]).toBe('/admin/playbooks/guia-de-calificacion');
  });

  it('clears an old destination when this login asks for none', async () => {
    cookieJar.get.mockImplementation((name: string) =>
      name === 'quill_next' ? { value: '/admin/developers/keys' } : undefined,
    );

    await GET(req('/api/auth/login'));

    expect(cookieJar.delete).toHaveBeenCalledWith('quill_next');
    expect(nextSet()).toBeUndefined();
  });

  it('clears an old destination when this login asks for one it refuses', async () => {
    cookieJar.get.mockImplementation((name: string) =>
      name === 'quill_next' ? { value: '/admin/developers/keys' } : undefined,
    );

    await GET(req('/api/auth/login?next=https%3A%2F%2Fevil.example'));

    expect(cookieJar.delete).toHaveBeenCalledWith('quill_next');
    expect(nextSet()).toBeUndefined();
  });
});
