/**
 * The sign-in callback hands a parked referral code to the person-level claim
 * (`POST /v1/me/referral/claim`), next to the workspace attribution record.
 * Whatever the claim does, the login that already succeeded still lands on
 * /admin.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const store = new Map<string, string>();
const cookieJar = {
  get: vi.fn((name: string) => (store.has(name) ? { value: store.get(name)! } : undefined)),
  set: vi.fn((name: string, value: string) => void store.set(name, value)),
  delete: vi.fn((name: string) => void store.delete(name)),
};
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => cookieJar) }));
vi.mock('@/lib/auth-session', () => ({ setSession: vi.fn(async () => {}), workosSessionIdFromJwt: () => null }));
vi.mock('@/lib/api-url', () => ({ serverApiUrl: 'https://api.example.test' }));

import { GET } from './route';

const SESSION = Buffer.from(JSON.stringify({ access_token: 'tok_abc' })).toString('base64');
const callback = () => GET(new NextRequest(`https://forms.example.com/api/auth/callback?session=${SESSION}`));

const fetchMock = vi.fn();
const callsTo = (path: string) =>
  fetchMock.mock.calls.filter(([url]) => String(url) === `https://api.example.test${path}`);

function park(attribution: Record<string, string>) {
  store.set('quill_attribution', JSON.stringify(attribution));
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  store.set('quill_oauth_state', 'state-1');
  // A language already chosen on this browser: the locale seed stays out of it.
  store.set('quill_locale', 'en');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ status: 200, ok: true, json: async () => ({}) });
});

describe('GET /api/auth/callback with a referral code parked', () => {
  it('sends the code to the referral claim, with the new token', async () => {
    park({ referralCode: 'k7m2p9qx', utmSource: 'whatsapp' });
    const res = await callback();

    const [claim] = callsTo('/v1/me/referral/claim');
    expect(claim).toBeDefined();
    const init = claim![1] as RequestInit & { headers: Record<string, string> };
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer tok_abc');
    expect(JSON.parse(String(init.body))).toEqual({ code: 'k7m2p9qx' });
    // The workspace record still gets the whole blob, as before.
    expect(callsTo('/v1/account/attribution')).toHaveLength(1);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/admin');
  });

  it('sends no claim without a code', async () => {
    park({ utmSource: 'google' });
    await callback();
    expect(callsTo('/v1/me/referral/claim')).toHaveLength(0);
    expect(callsTo('/v1/account/attribution')).toHaveLength(1);
  });

  it('a claim that throws still lands the person on /admin, and keeps the cookie for a retry', async () => {
    park({ referralCode: 'k7m2p9qx' });
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/v1/me/referral/claim')) throw new Error('socket hang up');
      return { status: 200, ok: true, json: async () => ({}) };
    });
    const res = await callback();
    expect(new URL(res.headers.get('location')!).pathname).toBe('/admin');
    expect(store.has('quill_attribution')).toBe(true);
  });

  it('a 5xx from the claim keeps the cookie; answers from both delete it', async () => {
    park({ referralCode: 'k7m2p9qx' });
    fetchMock.mockImplementation(async (url: string) => ({
      status: String(url).endsWith('/v1/me/referral/claim') ? 502 : 200,
      ok: true,
      json: async () => ({}),
    }));
    await callback();
    expect(store.has('quill_attribution')).toBe(true);

    store.set('quill_oauth_state', 'state-2');
    fetchMock.mockResolvedValue({ status: 200, ok: true, json: async () => ({}) });
    await callback();
    expect(store.has('quill_attribution')).toBe(false);
  });

  it('a refused claim (any 4xx) is the API having its say: the cookie goes', async () => {
    park({ referralCode: 'k7m2p9qx' });
    fetchMock.mockImplementation(async (url: string) => ({
      status: String(url).endsWith('/v1/me/referral/claim') ? 403 : 200,
      ok: false,
      json: async () => ({}),
    }));
    const res = await callback();
    expect(new URL(res.headers.get('location')!).pathname).toBe('/admin');
    expect(store.has('quill_attribution')).toBe(false);
  });

  it('a cookie that is not JSON is passed on as before and claims nothing', async () => {
    store.set('quill_attribution', 'not-json');
    const res = await callback();
    expect(callsTo('/v1/me/referral/claim')).toHaveLength(0);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/admin');
  });
});

/**
 * The callback forwards the first-party browser id (lib/browser-id.ts) on its
 * API calls, so the claim can refuse a referral from a browser the referrer
 * was seen in. It never deletes it.
 */
describe('GET /api/auth/callback, the browser id', () => {
  const BID = 'Q2hyb21lQ2hyb21lQ2hyb21lQ2hyb21lQ2hyb21lQ2g';

  it('sends the browser id with the referral claim and the attribution record', async () => {
    store.set('dforms_bid', BID);
    park({ referralCode: 'k7m2p9qx' });
    await callback();

    const [claim] = callsTo('/v1/me/referral/claim');
    expect((claim![1] as { headers: Record<string, string> }).headers['x-quill-browser']).toBe(BID);
    const [record] = callsTo('/v1/account/attribution');
    expect((record![1] as { headers: Record<string, string> }).headers['x-quill-browser']).toBe(BID);
    expect(store.get('dforms_bid')).toBe(BID);
    expect(cookieJar.delete).not.toHaveBeenCalledWith('dforms_bid');
  });

  it('a browser that lost it mid-login gets one, and the claim carries it', async () => {
    park({ referralCode: 'k7m2p9qx' });
    await callback();

    const minted = store.get('dforms_bid');
    expect(minted).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [claim] = callsTo('/v1/me/referral/claim');
    expect((claim![1] as { headers: Record<string, string> }).headers['x-quill-browser']).toBe(minted);
  });

  it('a malformed cookie is replaced, never forwarded', async () => {
    store.set('dforms_bid', 'bad; value');
    park({ referralCode: 'k7m2p9qx' });
    await callback();

    const [claim] = callsTo('/v1/me/referral/claim');
    const sent = (claim![1] as { headers: Record<string, string> }).headers['x-quill-browser'];
    expect(sent).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sent).toBe(store.get('dforms_bid'));
  });
});

/**
 * A destination parked by /api/auth/login (lib/return-path.ts). The callback
 * lands on it instead of /admin and leaves the cookie for the onboarding
 * wizard, which spends it on a first visit.
 */
describe('GET /api/auth/callback, the parked destination', () => {
  it('lands on /admin when none was parked', async () => {
    const res = await callback();
    expect(new URL(res.headers.get('location')!).pathname).toBe('/admin');
  });

  it.each(['/admin/playbooks', '/admin/playbooks/guia-de-calificacion', '/admin/developers/keys'])(
    'lands on %s, and leaves it for the wizard',
    async (next) => {
      store.set('quill_next', next);
      const res = await callback();
      expect(new URL(res.headers.get('location')!).pathname).toBe(next);
      expect(cookieJar.delete).not.toHaveBeenCalledWith('quill_next');
    },
  );

  it('lands on a playbook with the reader language, query kept', async () => {
    store.set('quill_next', '/admin/playbooks/guia-de-calificacion?lang=en');
    const res = await callback();
    const target = new URL(res.headers.get('location')!);
    expect(target.host).toBe('forms.example.com');
    expect(target.pathname).toBe('/admin/playbooks/guia-de-calificacion');
    expect(target.search).toBe('?lang=en');
    expect(cookieJar.delete).not.toHaveBeenCalledWith('quill_next');
  });

  it.each(['?pdf=1', '?lang=es&pdf=1', '?lang=en&pdf=1'])('lands on a playbook asking for its PDF (%s)', async (query) => {
    store.set('quill_next', `/admin/playbooks/guia-de-calificacion${query}`);
    const res = await callback();
    const target = new URL(res.headers.get('location')!);
    expect(target.pathname).toBe('/admin/playbooks/guia-de-calificacion');
    expect(target.search).toBe(query);
  });

  it.each([
    '//evil.example',
    'https://evil.example/admin',
    '/admin/../login',
    '/admin/playbooks?categoria=ventas',
    '/admin/playbooks/x?lang=fr',
    '/admin/forms?lang=en',
    '/admin/playbooks?pdf=1',
    '/admin/playbooks/x?pdf=1&lang=en',
  ])(
    'ignores a tampered cookie (%s) and lands on /admin',
    async (next) => {
      store.set('quill_next', next);
      const res = await callback();
      const target = new URL(res.headers.get('location')!);
      expect(target.host).toBe('forms.example.com');
      expect(target.pathname).toBe('/admin');
      expect(target.search).toBe('');
    },
  );
});
