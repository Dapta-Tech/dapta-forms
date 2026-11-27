import { describe, expect, it } from 'vitest';
import { findPlaybook } from '@quill/shared/playbooks';
import { hubEntry } from './hub-entry';

describe('hubEntry', () => {
  it.each([
    ['/admin/playbooks/formularios-que-venden-con-ia', null],
    ['/admin/playbooks/formularios-que-venden-con-ia?lang=es', 'es'],
    ['/admin/playbooks/formularios-que-venden-con-ia?lang=en', 'en'],
    ['/admin/playbooks/formularios-que-venden-con-ia?pdf=1', null],
    ['/admin/playbooks/formularios-que-venden-con-ia?lang=en&pdf=1', 'en'],
    ['/admin/playbooks/formularios-que-venden-con-ia?lang=fr', null],
  ])('reads %s as a playbook, whatever its query', (next, playbookLocale) => {
    expect(hubEntry(next)).toEqual({ playbook: 'formularios-que-venden-con-ia', playbookLocale });
  });

  it('reads a slug that names no playbook as no hub entry', () => {
    expect(hubEntry('/admin/playbooks/no-such-playbook')).toBeNull();
  });

  it('reads a playbook that is not published yet as no hub entry', () => {
    const { publishedAt } = findPlaybook('hook-de-dolor')!;
    expect(hubEntry('/admin/playbooks/hook-de-dolor', publishedAt - 1)).toBeNull();
    expect(hubEntry('/admin/playbooks/hook-de-dolor', publishedAt)).not.toBeNull();
  });

  it.each([
    undefined,
    null,
    '',
    '/admin',
    '/admin/playbooks',
    '/admin/playbooks?lang=en',
    '/admin/playbooks/',
    '/admin/playbooks/a/b',
    '/admin/playbooks/Con-Mayusculas',
    '/admin/developers/keys',
    '/admin/forms/playbooks/x',
    'https://example.com/admin/playbooks/x',
    '//example.com/admin/playbooks/x',
    `/admin/playbooks/${'a'.repeat(200)}`,
  ])('reads %s as no hub entry', (next) => {
    expect(hubEntry(next)).toBeNull();
  });
});
