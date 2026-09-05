import { describe, expect, it } from 'vitest';
import { getMessages } from './index';

describe('admin.chrome docs link', () => {
  it('points each language at its own documentation site', () => {
    expect(getMessages('en').admin.chrome.docsHref).toBe('https://docs.dapta.ai/dapta-forms/forms');
    expect(getMessages('es').admin.chrome.docsHref).toBe('https://docs.dapta.ai/dapta-docs-es/dapta-forms/forms');
  });

  it('carries absolute URLs (the rail opens them in a new tab, so a relative path would 404 in the app)', () => {
    for (const locale of ['en', 'es'] as const) {
      const url = new URL(getMessages(locale).admin.chrome.docsHref);
      expect(url.protocol).toBe('https:');
      expect(url.hostname).toBe('docs.dapta.ai');
    }
  });

  it('labels the nav item in both languages', () => {
    expect(getMessages('en').admin.chrome.nav.docs).toBe('Docs');
    expect(getMessages('es').admin.chrome.nav.docs).toBe('Documentación');
  });
});
