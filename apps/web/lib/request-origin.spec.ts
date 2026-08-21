import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { originFrom, requestOrigin, selfHost } from './request-origin';

/** The two things `requestOrigin` reads off a request, and nothing else. */
function request(url: string, headers: Record<string, string> = {}): NextRequest {
  return {
    url,
    nextUrl: new URL(url),
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as NextRequest;
}

const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL;

beforeEach(() => {
  delete process.env.PUBLIC_APP_URL;
});

afterEach(() => {
  if (PUBLIC_APP_URL === undefined) delete process.env.PUBLIC_APP_URL;
  else process.env.PUBLIC_APP_URL = PUBLIC_APP_URL;
});

describe('requestOrigin', () => {
  it('trusts PUBLIC_APP_URL over any header', () => {
    process.env.PUBLIC_APP_URL = 'https://forms.example';
    const req = request('https://forms.example/api/auth/login', {
      'x-forwarded-host': 'evil.example',
      host: 'evil.example',
    });
    expect(requestOrigin(req)).toBe('https://forms.example');
  });

  it('uses the forwarded proto and host when the proxy sends both', () => {
    const req = request('http://10.0.0.7:3000/api/auth/login', {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'forms.example',
    });
    expect(requestOrigin(req)).toBe('https://forms.example');
  });

  // A deployment can forward Host and not X-Forwarded-Proto. Guessing http there
  // downgrades the OAuth returnTo and the logout landing, and the `?session=`
  // blob rides that redirect.
  it('keeps the request scheme when the host is forwarded without a proto', () => {
    const req = request('https://forms.example/api/auth/login', {
      host: 'forms.example',
    });
    expect(requestOrigin(req)).toBe('https://forms.example');
  });

  it('stays on http when that is what the request itself was', () => {
    const req = request('http://localhost:3000/api/auth/login', { host: 'localhost:3000' });
    expect(requestOrigin(req)).toBe('http://localhost:3000');
  });

  it('falls back to the request URL when no host resolves at all', () => {
    expect(requestOrigin(request('https://forms.example/api/auth/login'))).toBe(
      'https://forms.example',
    );
  });
});

describe('originFrom', () => {
  const get = (entries: Record<string, string>) => (k: string) => entries[k.toLowerCase()] ?? null;

  // Server actions hold `headers()` and no request, so there is no scheme to
  // read: http stays the only guess available to them.
  it('guesses http for a caller that cannot supply a scheme', () => {
    expect(originFrom(get({ host: 'forms.example' }))).toBe('http://forms.example');
  });

  it('uses the supplied fallback scheme when there is no forwarded proto', () => {
    expect(originFrom(get({ host: 'forms.example' }), 'https')).toBe('https://forms.example');
  });

  it('prefers a forwarded proto over the fallback', () => {
    expect(originFrom(get({ host: 'forms.example', 'x-forwarded-proto': 'https' }), 'http')).toBe(
      'https://forms.example',
    );
  });

  it('returns null when nothing trustworthy resolves', () => {
    expect(originFrom(get({}), 'https')).toBeNull();
  });
});

describe('selfHost', () => {
  it('takes the first hop of a chained x-forwarded-host', () => {
    const get = (k: string) =>
      k.toLowerCase() === 'x-forwarded-host' ? 'a.example, b.example' : null;
    expect(selfHost(get)).toBe('a.example');
  });
});
