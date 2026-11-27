import { describe, expect, it } from 'vitest';
import { hubEntry } from './hub-entry';

describe('hubEntry', () => {
  it.each([
    ['/admin/playbooks/formularios-que-venden', null],
    ['/admin/playbooks/formularios-que-venden?lang=es', 'es'],
    ['/admin/playbooks/formularios-que-venden?lang=en', 'en'],
    ['/admin/playbooks/formularios-que-venden?pdf=1', null],
    ['/admin/playbooks/formularios-que-venden?lang=en&pdf=1', 'en'],
    ['/admin/playbooks/formularios-que-venden?lang=fr', null],
  ])('reads %s as a playbook, whatever its query', (next, playbookLocale) => {
    expect(hubEntry(next)).toEqual({ playbook: 'formularios-que-venden', playbookLocale });
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
