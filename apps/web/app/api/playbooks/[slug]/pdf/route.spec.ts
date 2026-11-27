/**
 * The only way to a playbook's PDF: signed in, one the API says is published,
 * in the language the API serves it in, as an attachment nobody caches or
 * indexes. The files read are the committed ones.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getSession = vi.fn();
const setSession = vi.fn();
const refreshUpstreamSession = vi.fn();
vi.mock('@/lib/auth-session', () => ({
  getSession: (...a: unknown[]) => getSession(...a),
  setSession: (...a: unknown[]) => setSession(...a),
  refreshUpstreamSession: (...a: unknown[]) => refreshUpstreamSession(...a),
  hostHeaders: async () => ({ authorization: 'Bearer tok' }),
}));

import { GET } from './route';

const SLUG = 'hook-de-dolor';
const ORIGIN = 'https://forms.example.com';
const fetchMock = vi.fn();

const answer = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const published = (locale: string) => answer(200, { playbook: { slug: SLUG, locale } });

const get = (slug = SLUG, query = '?lang=es', headers: Record<string, string> = {}) =>
  GET(new NextRequest(`${ORIGIN}/api/playbooks/${slug}/pdf${query}`, { headers }), {
    params: Promise.resolve({ slug }),
  });
const committed = (locale: string) => readFileSync(join(process.cwd(), 'assets', 'playbooks-pdf', locale, `${SLUG}.pdf`));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('PUBLIC_APP_URL', '');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  getSession.mockResolvedValue({ provider: 'workos', accessToken: 'tok', refreshToken: 'r' });
  refreshUpstreamSession.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllGlobals());

describe('GET /api/playbooks/[slug]/pdf, signed in', () => {
  it.each(['es', 'en'])('answers the %s file as a private attachment', async (lang) => {
    fetchMock.mockResolvedValue(published(lang));

    const res = await get(SLUG, `?lang=${lang}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="${SLUG}-${lang}.pdf"`);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(res.headers.get('content-length')).toBe(String(bytes.length));
    expect(bytes.equals(committed(lang))).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/v1/me/playbooks/${SLUG}?locale=${lang}`),
      expect.objectContaining({ headers: { authorization: 'Bearer tok' }, cache: 'no-store' }),
    );
  });

  it('serves the Spanish file when the API falls back to Spanish', async () => {
    fetchMock.mockResolvedValue(published('es'));

    const res = await get(SLUG, '?lang=en');

    expect(res.headers.get('content-disposition')).toContain(`${SLUG}-es.pdf`);
  });

  it('trades the refresh token once for an expired access token, then serves it', async () => {
    const fresh = { provider: 'workos', accessToken: 'new' };
    refreshUpstreamSession.mockResolvedValue(fresh);
    fetchMock.mockResolvedValueOnce(answer(401)).mockResolvedValueOnce(published('es'));

    const res = await get();

    expect(setSession).toHaveBeenCalledWith(fresh);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('GET /api/playbooks/[slug]/pdf, refused', () => {
  const login = (lang: string) =>
    `${ORIGIN}/api/auth/login?next=${encodeURIComponent(`/admin/playbooks/${SLUG}?lang=${lang}&pdf=1`)}`;
  const noFile = async (res: Response) => {
    expect(res.headers.get('content-type') ?? '').not.toContain('pdf');
    expect(res.headers.get('content-disposition')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect((await res.text()).startsWith('%PDF')).toBe(false);
  };

  it.each(['es', 'en'])('sends someone without a session to sign in, and back to the %s download', async (lang) => {
    getSession.mockResolvedValue(null);
    fetchMock.mockResolvedValue(answer(401));

    const res = await get(SLUG, `?lang=${lang}`);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(login(lang));
    await noFile(res);
  });

  it('does not loop on the refresh: a second 401 goes to sign in', async () => {
    refreshUpstreamSession.mockResolvedValue({ provider: 'workos', accessToken: 'new' });
    fetchMock.mockResolvedValue(answer(401));

    const res = await get();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.headers.get('location')).toBe(login('es'));
  });

  it('leaves a workspace that is no longer theirs to the playbook page', async () => {
    fetchMock.mockResolvedValue(answer(403, { error: 'WORKSPACE_FORBIDDEN' }));

    const res = await get();

    expect(res.headers.get('location')).toBe(`${ORIGIN}/admin/playbooks/${SLUG}?lang=es`);
    await noFile(res);
  });

  it('is a 404 for a slug the catalog has not published', async () => {
    fetchMock.mockResolvedValue(answer(404));

    const res = await get('todavia-no');

    expect(res.status).toBe(404);
    await noFile(res);
  });

  it.each([
    ['a path in the slug', '../../../package', '?lang=es'],
    ['an encoded path in the slug', '..%2F..%2Fpackage', '?lang=es'],
    ['an upper-case slug', 'Hook', '?lang=es'],
    ['no language', SLUG, ''],
    ['another language', SLUG, '?lang=pt'],
    ['a path for a language', SLUG, '?lang=..%2Fes'],
  ])('is a 404 for %s, without asking the API', async (_label, slug, query) => {
    const res = await get(slug, query);

    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    await noFile(res);
  });

  it.each([
    ['unreachable', () => Promise.reject(new Error('down'))],
    ['failing', () => Promise.resolve(answer(500))],
    ['answering a language that is not one', () => Promise.resolve(published('../x'))],
  ])('is a 502 with the API %s', async (_label, reply) => {
    fetchMock.mockImplementation(reply);

    const res = await get();

    expect(res.status).toBe(502);
    await noFile(res);
  });

  it('hops to PUBLIC_APP_URL from another host before reading a cookie', async () => {
    vi.stubEnv('PUBLIC_APP_URL', 'https://app.example.com');

    const res = await get(SLUG, '?lang=es', { host: 'old.example.org', 'sec-fetch-mode': 'navigate' });

    expect(res.headers.get('location')).toBe(`https://app.example.com/api/playbooks/${SLUG}/pdf?lang=es`);
    expect(getSession).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
