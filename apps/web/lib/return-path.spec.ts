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
    ['a fragment', '/admin#x'],
    ['an encoded slash', '/admin/%2F%2Fevil.example'],
    ['an empty value', ''],
    ['a non-string', 42],
    ['a very long path', `/admin/${'a'.repeat(300)}`],
  ])('rejects %s', (_label, raw) => {
    expect(safeNextPath(raw)).toBeNull();
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
