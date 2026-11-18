/**
 * The rail's "Connect your agent" item (keyed `developers`, once "Developers",
 * then the "MCP" group): a prominent link right after Integrations and before
 * Docs, in both rails (the desktop one, open or collapsed, and the mobile
 * drawer), straight to the connector guide. It stays lit on every
 * `/admin/developers` page, the API docs included.
 *
 * Both rails are in the server markup at once (the drawer is translated off
 * screen, not unmounted), so one render covers the desktop rail and the drawer.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getMessages, type Locale } from '@quill/shared';

const nav = vi.hoisted(() => ({ pathname: '/admin' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

import { AdminShell } from './admin-shell';

function render(opts: { pathname: string; collapsed?: boolean; locale?: Locale }) {
  nav.pathname = opts.pathname;
  const m = getMessages(opts.locale ?? 'en').admin;
  return renderToStaticMarkup(
    <AdminShell
      user={{ displayName: 'Alex Rivera', email: 'alex@example.com' }}
      messages={m.chrome}
      accountNav={m.account.nav}
      initialCollapsed={opts.collapsed ?? false}
    >
      <p>page</p>
    </AdminShell>,
  );
}

/** The two copies of the rail, in DOM order: desktop first, then the drawer. */
const rails = (html: string) => {
  const drawer = html.indexOf('role="dialog"');
  return { desktop: html.slice(0, drawer), drawer: html.slice(drawer) };
};
/** Every "Connect your agent" link, as written in the markup. */
const links = (html: string) => html.match(/<a [^>]*data-testid="nav-developers"[^>]*>/g) ?? [];
/** The first link's whole markup, icon and label included. */
const linkBody = (html: string) => html.match(/<a [^>]*data-testid="nav-developers".*?<\/a>/)?.[0] ?? '';

describe('AdminShell: Connect your agent', () => {
  it('is a prominent link to the connector guide in the desktop rail and in the drawer, with the rotating AI logos', () => {
    const html = render({ pathname: '/admin' });
    const { desktop, drawer } = rails(html);
    for (const rail of [desktop, drawer]) {
      const [a] = links(rail);
      expect(a).toContain('href="/admin/developers/connect"');
      expect(a).toContain('data-prominent="true"');
      expect(a).toContain('ring-signal/30');
      const icon = linkBody(rail);
      // Claude, ChatGPT and Cursor, stacked; the first one shows on first paint.
      expect(icon.match(/data-logo="(\w+)"/g)).toEqual(['data-logo="claude"', 'data-logo="openai"', 'data-logo="cursor"', 'data-logo="openclaw"', 'data-logo="hermes"']);
      expect(icon).toMatch(/data-logo="claude" data-active="true"/);
      expect(icon).toMatch(/<svg [^>]*data-logo="claude"[^>]*style="color:#d97757"/);
      // Drawn inline: a session replay cannot fetch a mask file, so nothing here loads one.
      expect(icon).not.toMatch(/url\((?!#)/);
      expect(icon).toContain('width:20px;height:20px');
    }
    expect(html).not.toContain('nav-developers-pages');
    expect(html).not.toMatch(/href="\/admin\/developers"/);
  });

  it('sits after Integrations and before Docs', () => {
    const html = render({ pathname: '/admin' });
    const integrations = html.indexOf('href="/admin/integrations"');
    const developers = html.indexOf('data-testid="nav-developers"');
    const docs = html.indexOf('data-testid="nav-docs"');
    expect(integrations).toBeGreaterThan(-1);
    expect(developers).toBeGreaterThan(integrations);
    expect(docs).toBeGreaterThan(developers);
  });

  it('is named in both languages, and the logos are hidden from screen readers', () => {
    for (const locale of ['en', 'es'] as const) {
      const chrome = getMessages(locale).admin.chrome;
      const html = render({ pathname: '/admin', locale });
      expect(html).toContain(`>${chrome.nav.developers}</span>`);
      expect(html).not.toContain('Developers');
      const stacks = html.match(/<span[^>]*data-testid="mcp-logos"[^>]*>/g) ?? [];
      expect(stacks).toHaveLength(2);
      for (const logos of stacks) expect(logos).toContain('aria-hidden="true"');
    }
    expect(getMessages('en').admin.chrome.nav.developers).toBe('Connect your agent');
    expect(getMessages('es').admin.chrome.nav.developers).toBe('Conecta tu agente');
  });

  it('is marked as the page you are on on the connect page, and pulses everywhere else', () => {
    for (const a of links(render({ pathname: '/admin/developers/connect' }))) {
      expect(a).toContain('aria-current="page"');
      expect(a).toContain('before:bg-primary-edge');
      expect(a).not.toContain('rail-pulse');
    }
    for (const pathname of ['/admin/integrations', '/admin/developers/tools']) {
      for (const a of links(render({ pathname }))) {
        expect(a).not.toContain('aria-current');
        expect(a).toContain('rail-pulse');
      }
    }
  });

  it('is followed by Tools, a plain link marked on its own page', () => {
    const html = render({ pathname: '/admin/developers/tools' });
    const tools = html.match(/<a [^>]*href="\/admin\/developers\/tools"[^>]*>/g) ?? [];
    expect(tools).toHaveLength(2);
    for (const a of tools) expect(a).toContain('aria-current="page"');
    expect(html.indexOf('href="/admin/developers/tools"')).toBeGreaterThan(html.indexOf('data-testid="nav-developers"'));
    for (const locale of ['en', 'es'] as const) {
      expect(render({ pathname: '/admin', locale })).toContain(`>${getMessages(locale).admin.chrome.nav.tools}</span>`);
    }
    expect(html).not.toContain('/admin/developers/docs');
  });

  it('on the collapsed rail, keeps its name for the icon-only tile', () => {
    const { desktop } = rails(render({ pathname: '/admin/developers/connect', collapsed: true }));
    const [a] = links(desktop);
    expect(a).toContain('title="Connect your agent"');
    expect(linkBody(desktop)).toContain('<span class="sr-only">Connect your agent</span>');
    expect(linkBody(desktop)).toContain('data-testid="mcp-logos"');
  });
});

/** Every Integrations link, and the first one's whole markup. */
const integrationLinks = (html: string) => html.match(/<a [^>]*data-testid="nav-integrations"[^>]*>/g) ?? [];
const integrationBody = (html: string) => html.match(/<a [^>]*data-testid="nav-integrations"[\s\S]*?<\/a>/)?.[0] ?? '';

describe('AdminShell: Integrations', () => {
  it('rotates the integration marks in both rails, starting on HubSpot, hidden from screen readers', () => {
    const { desktop, drawer } = rails(render({ pathname: '/admin' }));
    for (const rail of [desktop, drawer]) {
      const [a] = integrationLinks(rail);
      expect(a).toContain('href="/admin/integrations"');
      const body = integrationBody(rail);
      expect(body).toMatch(/<span[^>]*aria-hidden="true"[^>]*data-testid="integration-logos"[^>]*style="width:20px;height:20px"/);
      expect(body).toMatch(/data-logo="hubspot" data-active="true"/);
      expect(body).not.toContain('pi-link');
    }
  });

  it('stays a plain row: no green tint and no glow, so "Connect your agent" is the one invitation', () => {
    for (const pathname of ['/admin', '/admin/integrations']) {
      for (const a of integrationLinks(render({ pathname }))) {
        expect(a).not.toContain('data-prominent');
        expect(a).not.toContain('rail-pulse');
        expect(a).not.toContain('ring-signal');
      }
    }
  });

  it('keeps its name in both languages and is marked as the page you are on', () => {
    for (const locale of ['en', 'es'] as const) {
      const chrome = getMessages(locale).admin.chrome;
      const html = render({ pathname: '/admin/integrations', locale });
      expect(integrationBody(html)).toContain(`>${chrome.nav.integrations}</span>`);
      for (const a of integrationLinks(html)) {
        expect(a).toContain('aria-current="page"');
        expect(a).toContain('before:bg-primary-edge');
      }
    }
  });

  it('on the collapsed rail keeps the label for screen readers and as a tooltip', () => {
    const { desktop } = rails(render({ pathname: '/admin', collapsed: true }));
    const label = getMessages('en').admin.chrome.nav.integrations;
    const [a] = integrationLinks(desktop);
    expect(a).toContain(`title="${label}"`);
    expect(integrationBody(desktop)).toContain(`<span class="sr-only">${label}</span>`);
  });
});
