/**
 * The old per-member page now lands on the workspace page with a real 308,
 * keeping the query string, and nothing a visitor typed can bend the
 * Location header.
 */
import { describe, expect, it } from 'vitest';
import { GET, HEAD } from './route';

const call = (fn: typeof GET, url: string, accountCode: string, handle = 'alex') =>
  fn(new Request(url), { params: Promise.resolve({ accountCode, handle }) });

describe('/[accountCode]/[handle]', () => {
  it('answers 308 to the workspace page', async () => {
    const res = await call(GET, 'http://localhost/acme/alex', 'acme');
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/acme');
  });

  it('keeps the query string, so UTMs survive the hop', async () => {
    const res = await call(GET, 'http://localhost/acme/alex?utm_source=card&lang=es', 'acme');
    expect(res.headers.get('location')).toBe('/acme?utm_source=card&lang=es');
  });

  it('answers HEAD the same way', async () => {
    expect((await call(HEAD, 'http://localhost/acme/alex', 'acme')).status).toBe(308);
  });

  it('is a 404, never a cached redirect, under a static route of the app', async () => {
    for (const first of ['admin', 'login', 'preview', 'onboarding', 'api', 'file', 'ADMIN']) {
      const res = await call(GET, `http://localhost/${first}/typo`, first, 'typo');
      expect(res.status, first).toBe(404);
      expect(res.headers.get('location'), first).toBeNull();
    }
  });

  it('is a 404 for a code that cannot be a workspace', async () => {
    const res = await call(GET, 'http://localhost/x/alex', 'bad%0d%0aSet-Cookie:x');
    expect(res.status).toBe(404);
    expect(res.headers.get('location')).toBeNull();
  });
});
