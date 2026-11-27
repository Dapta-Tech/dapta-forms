import { describe, expect, it } from 'vitest';
import { initialNavGroupOpen, isNavGroupActive, isNavItemActive, navGroupStorageKey } from './nav';

describe('isNavItemActive (admin shell)', () => {
  it('matches Home (/admin) exactly — never lights up on child routes', () => {
    expect(isNavItemActive('/admin', '/admin')).toBe(true);
    expect(isNavItemActive('/admin/forms', '/admin')).toBe(false);
    expect(isNavItemActive('/admin/settings', '/admin')).toBe(false);
  });

  it('matches a section by href prefix', () => {
    expect(isNavItemActive('/admin/forms', '/admin/forms')).toBe(true);
    expect(isNavItemActive('/admin/forms/123/edit', '/admin/forms')).toBe(true);
    expect(isNavItemActive('/admin/submissions', '/admin/forms')).toBe(false);
  });

  it('keeps global sections distinct from per-form surfaces', () => {
    // A per-form submissions page belongs to Forms, not the global Submissions.
    expect(isNavItemActive('/admin/forms/123/submissions', '/admin/submissions')).toBe(false);
    expect(isNavItemActive('/admin/forms/123/submissions', '/admin/forms')).toBe(true);
    expect(isNavItemActive('/admin/submissions', '/admin/submissions')).toBe(true);
  });

  it('honors explicit match prefixes', () => {
    expect(isNavItemActive('/admin/connections/new', '/admin/settings', ['/admin/connections'])).toBe(true);
    expect(isNavItemActive('/admin/forms', '/admin/settings', ['/admin/connections'])).toBe(false);
  });
});

describe('isNavGroupActive (a rail group with children)', () => {
  const help = [
    { href: '/admin/developers/tools' },
    { href: 'https://docs.example.com/', external: true },
  ];

  it('is active on any internal child page, and on what lies under it', () => {
    expect(isNavGroupActive('/admin/developers/tools', help)).toBe(true);
    expect(isNavGroupActive('/admin/developers/tools/forms', help)).toBe(true);
  });

  it('is not active elsewhere, the sibling pages included', () => {
    expect(isNavGroupActive('/admin', help)).toBe(false);
    expect(isNavGroupActive('/admin/developers/connect', help)).toBe(false);
    expect(isNavGroupActive('/admin/developers/toolsx', help)).toBe(false);
  });

  it('never counts an external child, even if its href would match', () => {
    expect(isNavGroupActive('/admin/docs', [{ href: '/admin/docs', external: true }])).toBe(false);
  });

  it('honors a child match list', () => {
    const group = [{ href: '/admin/a', match: ['/admin/a', '/admin/b'] }];
    expect(isNavGroupActive('/admin/b/1', group)).toBe(true);
  });
});

describe('initialNavGroupOpen', () => {
  it('opens on a child page whatever was stored', () => {
    for (const stored of [null, '0', '1']) expect(initialNavGroupOpen(true, stored)).toBe(true);
  });

  it('elsewhere follows what the person left it at, closed by default', () => {
    expect(initialNavGroupOpen(false, null)).toBe(false);
    expect(initialNavGroupOpen(false, '0')).toBe(false);
    expect(initialNavGroupOpen(false, '1')).toBe(true);
    expect(initialNavGroupOpen(false, 'garbage')).toBe(false);
  });

  it('keys each group apart', () => {
    expect(navGroupStorageKey('help')).toBe('forms.nav.group.help');
  });
});
