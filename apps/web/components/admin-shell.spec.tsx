/**
 * The rail's "MCP" item (keyed `developers`, formerly labelled "Developers"): in
 * the list right after Integrations and before
 * Docs, in both rails (the desktop one, open or collapsed, and the mobile
 * drawer). It is a group with two pages under it, API keys and API docs: an
 * accordion in the wide rail and the drawer, a flyout menu on the collapsed
 * rail. The group opens on its own on one of its routes, and the parent and
 * the page you are on are both marked.
 *
 * Both rails are in the server markup at once (the drawer is translated off
 * screen, not unmounted), so one render covers the desktop rail and the drawer.
 * The flyout is portalled and only exists once opened in a browser: see
 * admin-shell.interaction.spec.tsx.
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getMessages, type Locale } from '@quill/shared';

const nav = vi.hoisted(() => ({ pathname: '/admin' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
// Like the real one on the server: a portal has no DOM to go to, so nothing.
vi.mock('@/components/ui/anchored-menu', () => ({
  AnchoredMenu: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-menu>{children}</div> : null,
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
/** Every MCP trigger (a button, not a link), as written in the markup. */
const triggers = (html: string) => html.match(/<button [^>]*data-testid="nav-developers"[^>]*>/g) ?? [];
/** The first trigger's whole markup, icon and label included. */
const triggerBody = (html: string) => html.match(/<button [^>]*data-testid="nav-developers".*?<\/button>/)?.[0] ?? '';
/** Every `<a>` pointing at one of the pages under the group. */
const pageLinks = (html: string, page: 'keys' | 'docs') =>
  html.match(new RegExp(`<a [^>]*href="/admin/developers/${page}"[^>]*>`, 'g')) ?? [];

describe('AdminShell: MCP group', () => {
  it('appears in the desktop rail and in the mobile drawer, with the rotating AI logos as its icon', () => {
    const html = render({ pathname: '/admin' });
    const { desktop, drawer } = rails(html);
    expect(triggers(desktop)).toHaveLength(1);
    expect(triggers(drawer)).toHaveLength(1);
    expect(html).not.toContain('pi-code');
    for (const rail of [desktop, drawer]) {
      const icon = triggerBody(rail);
      // Claude, ChatGPT and Cursor, stacked; the first one shows on first paint.
      expect(icon.match(/data-logo="(\w+)"/g)).toEqual(['data-logo="claude"', 'data-logo="openai"', 'data-logo="cursor"']);
      expect(icon.match(/is-active/g)).toHaveLength(1);
      expect(icon).toMatch(/data-logo="claude" data-active="true"/);
      // Claude in its own orange, in every rail; the others take the row's ink.
      expect(icon).toMatch(/data-logo="claude"[^>]*background-color:#d97757/);
      expect(icon).not.toMatch(/data-logo="(openai|cursor)"[^>]*background-color/);
      // Same 20px box as every other rail icon.
      expect(icon).toContain('width:20px;height:20px');
    }
  });

  it('is named MCP in both languages, and the logos are hidden from screen readers', () => {
    for (const locale of ['en', 'es'] as const) {
      const html = render({ pathname: '/admin', locale });
      expect(html).toContain('>MCP</span>');
      expect(html).not.toContain('Developers');
      const stacks = html.match(/<span[^>]*data-testid="mcp-logos"[^>]*>/g) ?? [];
      expect(stacks).toHaveLength(2); // the desktop rail and the drawer
      for (const logos of stacks) {
        expect(logos).toContain('aria-hidden="true"');
      }
    }
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

  it('never links to /admin/developers itself, which only redirects', () => {
    expect(render({ pathname: '/admin/developers/keys' })).not.toMatch(/href="\/admin\/developers"/);
  });

  it('is closed off its routes, and nothing in it is marked', () => {
    const html = render({ pathname: '/admin/integrations' });
    for (const b of triggers(html)) {
      expect(b).toContain('aria-expanded="false"');
      expect(b).not.toContain('bg-muted font-medium');
    }
    expect(pageLinks(html, 'keys')).toHaveLength(0);
    expect(pageLinks(html, 'docs')).toHaveLength(0);
  });

  it('opens on its own on one of its routes, in the rail and in the drawer', () => {
    for (const pathname of ['/admin/developers/keys', '/admin/developers/docs']) {
      const html = render({ pathname });
      for (const rail of Object.values(rails(html))) {
        const [b] = triggers(rail);
        expect(b).toContain('aria-expanded="true"');
        expect(b).toMatch(/aria-controls="[^"]+"/);
        expect(pageLinks(rail, 'keys')).toHaveLength(1);
        expect(pageLinks(rail, 'docs')).toHaveLength(1);
      }
    }
  });

  it('marks the page you are on and only that one, and the parent as the open group', () => {
    const cases = [
      { pathname: '/admin/developers/keys', here: 'keys', other: 'docs' },
      { pathname: '/admin/developers/docs', here: 'docs', other: 'keys' },
      // A deeper address under a page still belongs to it.
      { pathname: '/admin/developers/docs/forms', here: 'docs', other: 'keys' },
    ] as const;
    for (const { pathname, here, other } of cases) {
      const html = render({ pathname });
      for (const a of pageLinks(html, here)) expect(a).toContain('aria-current="page"');
      for (const a of pageLinks(html, other)) expect(a).not.toContain('aria-current');
      for (const b of triggers(html)) {
        // The parent says "you are in here" (ink, medium weight) but leaves
        // the wash and the accent bar to the page that IS the current one.
        expect(b).toContain('font-medium text-foreground');
        expect(b).not.toContain('before:bg-primary-edge');
        expect(b).not.toContain('aria-current');
      }
    }
  });

  it('shows the pages in the reader language, under the parent label', () => {
    for (const locale of ['en', 'es'] as const) {
      const chrome = getMessages(locale).admin.chrome;
      const html = render({ pathname: '/admin/developers/keys', locale });
      expect(html).toContain(`>${chrome.nav.developers}</span>`);
      expect(html).toContain(`>${chrome.developersMenu.keys}</span>`);
      expect(html).toContain(`>${chrome.developersMenu.docs}</span>`);
    }
  });

  describe('on the collapsed rail', () => {
    it('is a menu button with a name, marked as the current group on its routes', () => {
      const { desktop } = rails(render({ pathname: '/admin/developers/keys', collapsed: true }));
      const [b] = triggers(desktop);
      expect(b).toContain('aria-haspopup="menu"');
      expect(b).toContain('aria-expanded="false"');
      expect(b).toContain('title="MCP"');
      // The icon is the logos here too, inside the 44px tile.
      expect(triggerBody(desktop)).toContain('data-testid="mcp-logos"');
      // Only the icon shows, so the icon carries the whole "you are here".
      expect(b).toContain('bg-muted font-medium text-foreground');
      expect(b).toContain('before:bg-primary-edge');
      expect(desktop).toContain('<span class="sr-only">MCP</span>');
    });

    it('does not lay the accordion into the 64px rail; the drawer still has it', () => {
      const { desktop, drawer } = rails(render({ pathname: '/admin/developers/keys', collapsed: true }));
      expect(pageLinks(desktop, 'keys')).toHaveLength(0);
      expect(pageLinks(drawer, 'keys')).toHaveLength(1);
      expect(triggers(drawer)[0]).not.toContain('aria-haspopup');
    });

    it('rests collapsed in the editor, like the rest of the rail', () => {
      const { desktop } = rails(render({ pathname: '/admin/forms/f1/edit' }));
      expect(triggers(desktop)[0]).toContain('aria-haspopup="menu"');
    });
  });
});
