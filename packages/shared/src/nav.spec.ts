import { describe, expect, it } from 'vitest';
import { isNavItemActive } from './nav';

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
