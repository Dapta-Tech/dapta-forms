/**
 * The Tools page: every tool of the MCP server, grouped, each with a plain
 * one-liner and an example request, in the reader's language. No routes, no
 * parameters, no JSON.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { CATALOG } from '@quill/mcp';
import { getMessages, type Locale } from '@quill/shared';

const locale = vi.hoisted(() => ({ value: 'en' as Locale }));
vi.mock('@/lib/locale', () => ({ getLocale: async () => locale.value }));

import ToolsPage from './page';

const render = async () => renderToStaticMarkup((await ToolsPage()) as ReactElement);

describe('the Tools page', () => {
  beforeEach(() => {
    locale.value = 'en';
  });

  it('lists every tool the MCP serves, once, with what it does and what to ask', async () => {
    for (const l of ['en', 'es'] as const) {
      locale.value = l;
      const html = await render();
      const x = getMessages(l).admin.developers.tools;
      const listed = [...html.matchAll(/data-tool="([a-z_]+)"/g)].map((r) => r[1]);
      expect([...listed].sort()).toEqual(CATALOG.map((t) => t.name).sort());
      for (const tool of CATALOG) {
        const item = x.items[tool.name]!;
        expect(item.what, `${l} ${tool.name}`).toBeTruthy();
        expect(item.ask, `${l} ${tool.name}`).toBeTruthy();
        expect(html).toContain(item.what.replace(/'/g, '&#x27;'));
      }
      for (const g of Object.values(x.groups)) expect(html).toContain(g.title);
    }
  });

  it('says nothing technical: no HTTP, no JSON, no parameters, no tool names on screen', async () => {
    const html = await render();
    const text = html.replace(/<[^>]+>/g, ' ');
    expect(text).not.toMatch(/\b(GET|POST|PUT|DELETE)\b|\/v1\/|curl|\{\s*"|_id\b/);
    for (const tool of CATALOG) expect(text).not.toContain(tool.name);
  });

  it('leads to the connect page', async () => {
    const html = await render();
    const link = html.match(/<a [^>]*data-testid="tools-connect-link"[^>]*>/)?.[0] ?? '';
    expect(link).toContain('href="/admin/developers/connect"');
  });
});
