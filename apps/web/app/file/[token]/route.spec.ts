import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-url', () => ({ serverApiUrl: 'http://api.internal:4000' }));

import { GET } from './route';

const TOKEN = 'v1.payload.signature';
const SIGNED = 'https://bucket.example/uploads/a/f/s/1.pdf?X-Amz-Signature=abc';

const fetchMock = vi.fn();

function call(token: string, headers: Record<string, string> = {}): Promise<Response> {
  const req = new Request(`https://forms.example.com/file/${token}`, { headers });
  return GET(req, { params: Promise.resolve({ token }) });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /file/[token]', () => {
  it('redirects with a 302 to the signed URL the API returns, uncached and with no referrer', async () => {
    fetchMock.mockResolvedValue(Response.json({ url: SIGNED, disposition: 'inline' }));
    const res = await call(TOKEN, { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(SIGNED);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`http://api.internal:4000/v1/public/files/${TOKEN}`);
    expect(init.cache).toBe('no-store');
    // The visitor's chain, verbatim, so the API rate-limits the visitor.
    expect(init.headers).toEqual({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' });
  });

  it('answers 404 when the API does, in the visitor language', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'NOT_FOUND' }, { status: 404 }));
    const res = await call(TOKEN, { 'accept-language': 'es-CO,es;q=0.9' });
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toContain('No encontrado');
  });

  it('answers 404 for something that is not a token, without calling the API', async () => {
    for (const junk of ['a%2Fb', 'x'.repeat(600), 'has space']) {
      const res = await call(junk);
      expect(res.status, junk.slice(0, 20)).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes a rate limit through with its retry hint', async () => {
    fetchMock.mockResolvedValue(
      new Response('{}', { status: 429, headers: { 'retry-after': '12' } }),
    );
    const res = await call(TOKEN);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('12');
  });

  it('says the service is unavailable, never "not found", when the API fails or is unreachable', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    expect((await call(TOKEN)).status).toBe(503);
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect((await call(TOKEN)).status).toBe(503);
  });

  it('never redirects anywhere but an http(s) URL', async () => {
    fetchMock.mockResolvedValue(Response.json({ url: 'javascript:alert(1)' }));
    const res = await call(TOKEN);
    expect(res.status).toBe(503);
    expect(res.headers.get('location')).toBeNull();
  });
});
