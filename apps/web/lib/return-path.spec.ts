import { describe, expect, it } from 'vitest';
import { safeNextPath, withNextPath } from './return-path';

describe('safeNextPath', () => {
  it('accepts a plain dashboard path', () => {
    expect(safeNextPath('/admin')).toBe('/admin');
    expect(safeNextPath('/admin/developers/keys')).toBe('/admin/developers/keys');
    expect(safeNextPath('  /admin/developers/keys ')).toBe('/admin/developers/keys');
  });

  it.each(['/admin/developers/keys', '/admin/developers/docs', '/admin/playbooks', '/admin/playbooks/guia-de-calificacion'])(
    'accepts %s, a page the landing links to',
    (path) => {
      expect(safeNextPath(path)).toBe(path);
    },
  );

  it('accepts a path of exactly 200 characters', () => {
    const path = `/admin/playbooks/${'a'.repeat(200 - '/admin/playbooks/'.length)}`;
    expect(path).toHaveLength(200);
    expect(safeNextPath(path)).toBe(path);
  });

  it.each(['/admin/playbooks/x?lang=en', '/admin/playbooks?lang=es', '/admin/playbooks/guia-de-calificacion?lang=es'])(
    'accepts %s, a playbook with the reader language',
    (path) => {
      expect(safeNextPath(path)).toBe(path);
    },
  );

  it('counts the language toward the 200 characters', () => {
    const base = `/admin/playbooks/${'a'.repeat(200 - '/admin/playbooks/'.length - '?lang=en'.length)}`;
    expect(safeNextPath(`${base}?lang=en`)).toBe(`${base}?lang=en`);
    expect(safeNextPath(`${base}a?lang=en`)).toBeNull();
  });

  it('trims a trailing newline but never lets one through', () => {
    // `.trim()` runs before the match, so the value that passes has none.
    expect(safeNextPath('/admin/playbooks/x?lang=en\n')).toBe('/admin/playbooks/x?lang=en');
    expect(safeNextPath('/admin/playbooks/x?lang=en\n')).not.toContain('\n');
  });

  it('takes the first of a repeated param', () => {
    expect(safeNextPath(['/admin/developers/keys', 'https://evil.example'])).toBe('/admin/developers/keys');
  });

  it.each([
    ['another host', 'https://evil.example/admin'],
    ['a protocol-relative URL', '//evil.example/admin'],
    ['a backslash host', '/\\evil.example'],
    ['a path outside the dashboard', '/login'],
    ['a look-alike prefix', '/adminx'],
    ['a trailing slash', '/admin/'],
    ['a parent segment', '/admin/../login'],
    ['a query string', '/admin/developers/keys?x=1'],
    ['a playbook with a category filter', '/admin/playbooks?categoria=ventas'],
    ['a playbook slug with a query', '/admin/playbooks/guia?utm_source=x'],
    ['a parent segment below playbooks', '/admin/playbooks/../../login'],
    ['an encoded parent segment', '/admin/playbooks/%2E%2E/login'],
    ['a playbook on another host', 'https://evil.example/admin/playbooks/guia'],
    ['a dot segment', '/admin/playbooks/./guia'],
    ['a path of 201 characters', `/admin/playbooks/${'a'.repeat(201 - '/admin/playbooks/'.length)}`],
    ['a language the reader does not have', '/admin/playbooks/x?lang=fr'],
    ['a language plus another parameter', '/admin/playbooks/x?lang=en&x=1'],
    ['another parameter before the language', '/admin/playbooks/x?x=1&lang=en'],
    ['a parameter other than the language', '/admin/playbooks/x?foo=1'],
    ['the language outside the playbooks', '/admin/forms?lang=en'],
    ['the language on the dashboard root', '/admin?lang=en'],
    ['the language on a look-alike prefix', '/admin/playbooksx?lang=en'],
    ['the language with a trailing slash', '/admin/playbooks/?lang=en'],
    ['an upper-case language', '/admin/playbooks/x?lang=EN'],
    ['an empty language', '/admin/playbooks/x?lang='],
    ['a repeated language', '/admin/playbooks/x?lang=en&lang=es'],
    ['a language with a fragment', '/admin/playbooks/x?lang=en#x'],
    ['a language followed by a host', '/admin/playbooks/x?lang=en//evil.example'],
    ['a parent segment before the language', '/admin/playbooks/../forms?lang=en'],
    ['a language on another host', 'https://evil.example/admin/playbooks/x?lang=en'],
    ['a backslash below playbooks', '/admin/playbooks\\evil.example?lang=en'],
    ['an encoded CRLF', '/admin/playbooks/x?lang=en%0d%0a'],
    ['an encoded CRLF in the path', '/admin/playbooks/x%0d%0aSet-Cookie:a=b?lang=en'],
    ['an encoded question mark', '/admin/playbooks/x%3Flang=en'],
    ['a literal newline after the language', '/admin/playbooks/x?lang=en\nx'],
    ['a newline ending the path before the language', '/admin/playbooks/x\n?lang=en'],
    ['a double slash after playbooks', '/admin/playbooks//evil.example?lang=en'],
    ['a fragment', '/admin#x'],
    ['an encoded slash', '/admin/%2F%2Fevil.example'],
    ['an empty value', ''],
    ['a non-string', 42],
    ['a very long path', `/admin/${'a'.repeat(300)}`],
  ])('rejects %s', (_label, raw) => {
    expect(safeNextPath(raw)).toBeNull();
  });
});

describe('the language through the round-trip', () => {
  const next = '/admin/playbooks/guia?lang=en';

  it('survives the root hand-off to the login route', () => {
    // app/page.tsx encodes it; api/auth/login reads it back with getAll.
    const handoff = new URL(withNextPath('/api/auth/login?utm_source=x', next), 'https://app.example.test');
    expect(handoff.searchParams.getAll('next')).toEqual([next]);
    expect(safeNextPath(handoff.searchParams.getAll('next'))).toBe(next);
  });

  it('survives a landing link that does not encode it', () => {
    const params = new URLSearchParams('next=/admin/playbooks/guia?lang=en&utm_source=x');
    expect(safeNextPath(params.getAll('next'))).toBe(next);
  });

  it('reaches the final redirect with its query', () => {
    // api/auth/callback resolves it against the origin; the wizard redirects to it as is.
    const target = new URL(safeNextPath(next)!, 'https://app.example.test');
    expect(target.pathname).toBe('/admin/playbooks/guia');
    expect(target.search).toBe('?lang=en');
  });
});

describe('withNextPath', () => {
  it('appends next with ? or & and encodes it', () => {
    expect(withNextPath('/api/auth/login', '/admin/developers/keys')).toBe(
      '/api/auth/login?next=%2Fadmin%2Fdevelopers%2Fkeys',
    );
    expect(withNextPath('/api/auth/login?utm_source=x', '/admin/developers/keys')).toBe(
      '/api/auth/login?utm_source=x&next=%2Fadmin%2Fdevelopers%2Fkeys',
    );
  });

  it('leaves the URL alone without a destination', () => {
    expect(withNextPath('/api/auth/login?utm_source=x', null)).toBe('/api/auth/login?utm_source=x');
  });
});
