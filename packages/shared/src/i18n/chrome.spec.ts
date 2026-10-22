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

describe('admin.chrome MCP item', () => {
  it('labels the nav item Connect your agent in both languages, keyed as before', () => {
    expect(getMessages('en').admin.chrome.nav.developers).toBe('Connect your agent');
    expect(getMessages('es').admin.chrome.nav.developers).toBe('Conecta tu agente');
  });

  it('names the platform door Sales AI Agents, in the rail and the app switcher', () => {
    for (const [locale, label] of [['en', 'Sales AI Agents'], ['es', 'Agentes de ventas con IA']] as const) {
      const c = getMessages(locale).admin.chrome;
      expect(c.nav.agents).toBe(label);
      expect(c.switcher.dapta).toBe(label);
    }
  });

  it('is followed by Tools, named in both languages', () => {
    expect(getMessages('en').admin.chrome.nav.tools).toBe('Tools');
    expect(getMessages('es').admin.chrome.nav.tools).toBe('Herramientas');
  });

  it('keeps MCP as the eyebrow of the connect page', () => {
    expect(getMessages('en').admin.developers.title).toBe('MCP');
    expect(getMessages('es').admin.developers.title).toBe('MCP');
  });

  it('leaves no "Developers" anywhere a person reads, in either language', () => {
    const strings = (v: unknown): string[] =>
      typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];
    for (const locale of ['en', 'es'] as const) {
      const hits = strings(getMessages(locale)).filter((s) => /developers|desarrolladores/i.test(s));
      expect(hits, locale).toEqual([]);
    }
  });
});

describe('admin.developers: the connector, never keys, never the identity provider', () => {
  it('carries no API key copy at all: keys have no place in the dashboard any more', () => {
    for (const locale of ['en', 'es'] as const) {
      const m = getMessages(locale).admin.developers as Record<string, unknown>;
      expect(Object.keys(m)).not.toContain('keys');
      expect(Object.keys(m)).not.toContain('guide');
    }
  });

  it('never names Dapta on the connect page, the Tools page, the home promos or the menu entry', () => {
    const strings = (v: unknown): string[] =>
      typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];
    for (const locale of ['en', 'es'] as const) {
      const a = getMessages(locale).admin;
      const surfaces = [a.developers, a.home.agentBanner, a.home.agentCard, a.chrome.nav.developers, a.chrome.nav.tools];
      expect(strings(surfaces).filter((x) => /dapta/i.test(x)), locale).toEqual([]);
    }
  });
});
