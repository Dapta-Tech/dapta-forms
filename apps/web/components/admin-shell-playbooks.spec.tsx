// @vitest-environment happy-dom
/**
 * The rail's Playbooks item: always there, right after the Help group, and
 * marked "New" (the announcements' badge, popping once) while the person has
 * playbooks they have not seen, until the gallery is opened.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages, type Locale } from '@quill/shared';

const nav = vi.hoisted(() => ({ pathname: '/admin' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock('@/app/admin/announcement-actions', () => ({ recordAnnouncementAction: async () => ({ ok: true }) }));
vi.mock('@/lib/product-analytics', () => ({ captureEvent: () => {} }));

import { AdminShell } from './admin-shell';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function shell(opts: { collapsed?: boolean; locale?: Locale; playbooksNew?: number } = {}) {
  const m = getMessages(opts.locale ?? 'en').admin;
  return (
    <AdminShell
      user={{ displayName: 'Alex Rivera', email: 'alex@example.com' }}
      messages={m.chrome}
      accountNav={m.account.nav}
      initialCollapsed={opts.collapsed ?? false}
      playbooksNew={opts.playbooksNew}
    >
      <p>page</p>
    </AdminShell>
  );
}

/** The name a screen reader computes for a link: its text, minus what is aria-hidden. */
function accessibleName(el: Element): string {
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === 3) out += n.textContent ?? '';
    if (n.nodeType !== 1) return;
    if ((n as Element).getAttribute('aria-hidden') === 'true') return;
    n.childNodes.forEach(walk);
  };
  el.childNodes.forEach(walk);
  return out.trim();
}

/** The Playbooks link in the desktop rail and in the drawer. */
function playbooksLinks(root: ParentNode) {
  const [desktop, drawer] = [...root.querySelectorAll('[data-testid="nav-playbooks"]')];
  return { desktop: desktop!, drawer: drawer! };
}
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

let root: Root | undefined;
let host: HTMLDivElement | undefined;
async function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
}

beforeEach(() => {
  nav.pathname = '/admin';
  window.matchMedia = ((q: string) => ({
    matches: q.includes('min-width'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

describe('AdminShell: the Playbooks item', () => {
  it('links to the gallery, right after the Help group (Tools and Docs), in both rails', () => {
    const doc = parse(renderToStaticMarkup(shell()));
    const { desktop, drawer } = playbooksLinks(doc);
    for (const link of [desktop, drawer]) {
      expect(link.getAttribute('href')).toBe('/admin/playbooks');
      expect(accessibleName(link)).toBe('Playbooks');
      expect(link.querySelector('.pi-book-check')).not.toBeNull();
    }
    const nav = doc.querySelector('[data-testid="sidebar-nav"]')!;
    // The rail's own rows, top level only: the group's children live in its list.
    const order = [...nav.querySelectorAll(':scope > ul > li > [data-testid^="nav-"]')]
      .map((a) => a.getAttribute('data-testid'))
      .filter((id) => !id?.endsWith('-list'));
    expect(order.indexOf('nav-playbooks')).toBe(order.indexOf('nav-help') + 1);
    const children = [...nav.querySelectorAll('[data-testid="nav-help-list"] > li > [data-testid]')].map((a) =>
      a.getAttribute('data-testid'),
    );
    expect(children).toEqual(['nav-tools', 'nav-docs']);
  });

  it('is the page you are on in the gallery and in the reader', () => {
    for (const path of ['/admin/playbooks', '/admin/playbooks/manual-del-vendedor']) {
      nav.pathname = path;
      expect(playbooksLinks(parse(renderToStaticMarkup(shell()))).desktop.getAttribute('aria-current')).toBe('page');
    }
  });

  it('carries no badge with nothing new', () => {
    for (const playbooksNew of [undefined, 0]) {
      const html = renderToStaticMarkup(shell({ playbooksNew }));
      expect(html).not.toContain('nav-badge');
      expect(playbooksLinks(parse(html)).desktop.hasAttribute('data-badge')).toBe(false);
    }
  });

  it('is marked "New" with something new: a pill that pops once, read as "Playbooks, new"', () => {
    const { desktop, drawer } = playbooksLinks(parse(renderToStaticMarkup(shell({ playbooksNew: 3 }))));
    for (const link of [desktop, drawer]) {
      expect(link.getAttribute('data-badge')).toBe('new');
      const pill = link.querySelector('[data-testid="nav-badge"]')!;
      expect(pill.textContent).toBe('New');
      expect(pill.classList.contains('nav-badge-pop')).toBe(true);
      expect(accessibleName(link)).toBe('Playbooks, new');
    }
    const es = playbooksLinks(parse(renderToStaticMarkup(shell({ playbooksNew: 1, locale: 'es' })))).desktop;
    expect(es.querySelector('[data-testid="nav-badge"]')!.textContent).toBe('Nuevo');
    expect(accessibleName(es)).toBe('Playbooks, nuevo');
  });

  it('is a dot on the icon in the collapsed rail', () => {
    const { desktop } = playbooksLinks(parse(renderToStaticMarkup(shell({ playbooksNew: 2, collapsed: true }))));
    expect(desktop.querySelector('[data-testid="nav-badge"]')).toBeNull();
    expect(desktop.querySelector('[data-testid="nav-badge-dot"]')!.classList.contains('nav-badge-pop')).toBe(true);
    expect(desktop.getAttribute('title')).toBe('Playbooks, new');
  });

  it('pops only where the CSS lets it: never with reduced motion', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    expect(css).toMatch(/\.nav-badge-pop\s*\{\s*animation: nav-badge-pop 700ms ease-out 1;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.nav-badge-pop\s*\{\s*animation: none;/);
  });

  it('loses the badge when the gallery opens, and it stays gone for the rest of the load', async () => {
    await mount(shell({ playbooksNew: 3 }));
    expect(playbooksLinks(host!).desktop.getAttribute('data-badge')).toBe('new');

    // The reader alone does not end it: "New" is about the gallery.
    nav.pathname = '/admin/playbooks/manual-del-vendedor';
    await act(async () => root!.render(shell({ playbooksNew: 3 })));
    expect(playbooksLinks(host!).desktop.getAttribute('data-badge')).toBe('new');

    nav.pathname = '/admin/playbooks';
    await act(async () => root!.render(shell({ playbooksNew: 3 })));
    expect(playbooksLinks(host!).desktop.hasAttribute('data-badge')).toBe(false);

    // The layout is not re-rendered on client navigation: same stale count.
    nav.pathname = '/admin/forms';
    await act(async () => root!.render(shell({ playbooksNew: 3 })));
    expect(playbooksLinks(host!).desktop.hasAttribute('data-badge')).toBe(false);
  });

  it('shows no badge in the builder', () => {
    nav.pathname = '/admin/forms/f1/edit';
    expect(renderToStaticMarkup(shell({ playbooksNew: 3 }))).not.toContain('nav-badge');
  });
});
