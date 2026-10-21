import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import {
  canonicalHop,
  canonicalOriginElsewhere,
  headerHost,
  originFrom,
  requestOrigin,
  selfHost,
} from './request-origin';

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

describe('headerHost', () => {
  const get = (entries: Record<string, string>) => (k: string) => entries[k.toLowerCase()] ?? null;

  it('reads the headers even when PUBLIC_APP_URL is set (selfHost would not)', () => {
    process.env.PUBLIC_APP_URL = 'https://forms.example';
    expect(headerHost(get({ host: 'old.example' }))).toBe('old.example');
    expect(selfHost(get({ host: 'old.example' }))).toBe('forms.example');
  });

  it('prefers the first hop of X-Forwarded-Host over Host', () => {
    expect(headerHost(get({ 'x-forwarded-host': ' a.example , b.example', host: 'web:3000' }))).toBe('a.example');
    expect(headerHost(get({ host: ' web:3000 ' }))).toBe('web:3000');
  });

  it('is null when neither header carries anything', () => {
    expect(headerHost(get({}))).toBeNull();
    expect(headerHost(get({ 'x-forwarded-host': ' ', host: '' }))).toBeNull();
  });
});

describe('canonicalOriginElsewhere', () => {
  const get = (entries: Record<string, string>) => (k: string) => entries[k.toLowerCase()] ?? null;

  it('is null without PUBLIC_APP_URL, whatever the request host', () => {
    expect(canonicalOriginElsewhere(get({ host: 'old.example' }))).toBeNull();
    process.env.PUBLIC_APP_URL = '  ';
    expect(canonicalOriginElsewhere(get({ host: 'old.example' }))).toBeNull();
  });

  it('is null with an unparseable PUBLIC_APP_URL', () => {
    process.env.PUBLIC_APP_URL = 'not a url';
    expect(canonicalOriginElsewhere(get({ host: 'old.example' }))).toBeNull();
  });

  it('answers the configured origin, without its path, for another hostname', () => {
    process.env.PUBLIC_APP_URL = 'https://forms.example/some/path/';
    expect(canonicalOriginElsewhere(get({ host: 'old.example' }))).toBe('https://forms.example');
  });

  it('is null on the same hostname, whatever the case, port or scheme', () => {
    process.env.PUBLIC_APP_URL = 'https://Forms.Example';
    for (const host of ['forms.example', 'FORMS.EXAMPLE', 'forms.example:443', 'forms.example:8080']) {
      expect(canonicalOriginElsewhere(get({ host, 'x-forwarded-proto': 'http' }))).toBeNull();
    }
  });

  it('handles bracketed IPv6 hosts', () => {
    process.env.PUBLIC_APP_URL = 'http://[::1]:3000';
    expect(canonicalOriginElsewhere(get({ host: '[::1]:3400' }))).toBeNull();
    expect(canonicalOriginElsewhere(get({ host: '127.0.0.1:3000' }))).toBe('http://[::1]:3000');
  });

  it('is null when no host is readable or it does not parse', () => {
    process.env.PUBLIC_APP_URL = 'https://forms.example';
    expect(canonicalOriginElsewhere(get({}))).toBeNull();
    expect(canonicalOriginElsewhere(get({ host: 'bad host' }))).toBeNull();
    expect(canonicalOriginElsewhere(get({ host: 'forms.example:notaport' }))).toBeNull();
  });

  it('a trailing-dot hostname is another cookie host, so it hops (once: the target has no dot)', () => {
    process.env.PUBLIC_APP_URL = 'https://forms.example';
    expect(canonicalOriginElsewhere(get({ host: 'forms.example.' }))).toBe('https://forms.example');
  });
});

describe('canonicalHop', () => {
  const at = (path: string, method = 'GET', host = 'forms.example.org') =>
    canonicalHop(new NextRequest(`http://0.0.0.0:3000${path}`, { method, headers: { host } }));

  beforeEach(() => {
    process.env.PUBLIC_APP_URL = 'https://app.example.com';
  });

  it('is a 302 to the same path and query on PUBLIC_APP_URL, uncached, with no cookie', () => {
    const hop = at('/admin/forms?tab=all&q=a+b&empty=&bare');

    expect(hop?.status).toBe(302);
    expect(hop?.headers.get('location')).toBe('https://app.example.com/admin/forms?tab=all&q=a+b&empty=&bare');
    expect(hop?.headers.get('cache-control')).toBe('no-store');
    expect(hop?.headers.get('set-cookie')).toBeNull();
  });

  it('hops GET and HEAD only: a 302 would turn a POST into a GET and drop its body', () => {
    expect(at('/admin', 'HEAD')?.status).toBe(302);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) expect(at('/admin', method)).toBeNull();
  });

  it('is null wherever canonicalOriginElsewhere is', () => {
    expect(at('/admin', 'GET', 'app.example.com')).toBeNull();
    delete process.env.PUBLIC_APP_URL;
    expect(at('/admin')).toBeNull();
  });
});
