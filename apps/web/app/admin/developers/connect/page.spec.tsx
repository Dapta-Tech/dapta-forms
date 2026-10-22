/**
 * The connect page as the server renders it: the connector guide for this
 * environment's MCP address (or the note that the connector is not available
 * here) and what the MCP can do, leading to Tools. Nothing about API keys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { getMessages, type Locale } from '@quill/shared';

const locale = vi.hoisted(() => ({ value: 'en' as Locale }));
vi.mock('@/lib/locale', () => ({ getLocale: async () => locale.value }));

import ConnectPage from './page';

const MCP = 'https://mcp.forms.example.com/mcp';
const render = async () => renderToStaticMarkup((await ConnectPage()) as ReactElement);
const has = (html: string, id: string) => html.includes(`data-testid="${id}"`);

describe('the connect page', () => {
  beforeEach(() => {
    locale.value = 'en';
    process.env.MCP_OAUTH_PROVIDER = 'workos';
    process.env.MCP_PUBLIC_URL = MCP;
  });
  afterEach(() => {
    delete process.env.MCP_OAUTH_PROVIDER;
    delete process.env.MCP_PUBLIC_URL;
  });

  it('opens with the heading, the section name above it and the way to Tools', async () => {
    const html = await render();
    const m = getMessages('en').admin;
    expect(html).toMatch(new RegExp(`<h1[^>]*>${m.developers.connect.heading}</h1>`));
    const link = html.match(/<a [^>]*data-testid="tools-link"[^>]*>.*?<\/a>/)?.[0] ?? '';
    expect(link).toContain('href="/admin/developers/tools"');
    expect(link).toContain(m.chrome.nav.tools);
    expect(html).not.toContain('/admin/developers/docs');
  });

  it('shows the recommended card, its benefits and one tab per app, Claude first, with its animated walkthrough', async () => {
    const html = await render();
    const c = getMessages('en').admin.developers.connect;
    expect(html).toContain(c.signinTitle);
    for (const b of Object.values(c.benefits)) expect(html).toContain(b.title);
    const tabs = [...html.matchAll(/data-testid="mcp-app-([a-z-]+)"/g)].map((x) => x[1]);
    expect(tabs).toEqual(['tabs', 'claude', 'chatgpt', 'claude-code', 'codex', 'cursor', 'openclaw', 'hermes', 'panel']);
    expect(html).toMatch(/data-testid="mcp-walkthrough" data-kind="app" data-app="claude"/);
    expect(html).not.toMatch(/<video|\/mcp\/videos\//);
    expect(html).toContain(MCP);
  });

  it('never asks for a key and never names the identity provider', async () => {
    for (const l of ['en', 'es'] as const) {
      locale.value = l;
      const html = await render();
      expect(html).not.toContain('DFORMS_API_KEY');
      expect(html).not.toMatch(/Authorization|Bearer/);
      expect(html).not.toMatch(/Dapta/);
      expect(html).not.toMatch(/api-key|API keys|Llaves de API/);
    }
  });

  it('says the connector is not available without the sign-in, or without MCP_PUBLIC_URL', async () => {
    delete process.env.MCP_OAUTH_PROVIDER;
    let html = await render();
    expect(has(html, 'mcp-connect')).toBe(false);
    expect(has(html, 'mcp-connect-unavailable')).toBe(true);
    process.env.MCP_OAUTH_PROVIDER = 'workos';
    delete process.env.MCP_PUBLIC_URL;
    html = await render();
    expect(has(html, 'mcp-connect-unavailable')).toBe(true);
  });

  it('shows what the MCP can do in groups, linked to Tools', async () => {
    const html = await render();
    const x = getMessages('en').admin.developers;
    expect(html).toContain(x.connect.toolsTitle);
    for (const g of Object.values(x.tools.groups)) expect(html).toContain(g.title);
    expect(html).toContain('href="/admin/developers/tools#forms"');
  });

  it('speaks Spanish to a Spanish reader', async () => {
    locale.value = 'es';
    const html = await render();
    const es = getMessages('es').admin.developers;
    expect(html).toContain(es.connect.heading);
    expect(html).toContain(es.connect.signinTitle);
    expect(html).toContain(es.connect.apps.claude.steps[0]!.title);
  });
});
