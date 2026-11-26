// @vitest-environment happy-dom
/**
 * The rail's "Help" group: one parent row where Tools used to be, opening onto
 * Tools and Docs. A disclosure in the open rail and the drawer, a flyout menu
 * beside the icon on the 64px rail. Marked and opened by itself on a child
 * page; otherwise closed until the person opens it, and remembered per browser.
 */
import { act, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages, navGroupStorageKey, type AnnouncementRailItem, type Locale } from '@quill/shared';

const nav = vi.hoisted(() => ({ pathname: '/admin' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock('next/link', () => ({
  default: ({ children, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) => (
    <a
      {...rest}
      onClick={(e) => {
        e.preventDefault();
        onClick?.(e);
      }}
    >
      {children}
    </a>
  ),
}));
vi.mock('@/app/admin/announcement-actions', () => ({ recordAnnouncementAction: async () => ({ ok: true }) }));
vi.mock('@/lib/product-analytics', () => ({ captureEvent: () => {} }));

import { AdminShell, type ShellAnnouncement } from './admin-shell';
import { resetAnnouncementLoad } from './announcement/announcement-client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = navGroupStorageKey('help');

function shell(opts: { collapsed?: boolean; locale?: Locale; announcement?: ShellAnnouncement | null } = {}) {
  const m = getMessages(opts.locale ?? 'en').admin;
  return (
    <AdminShell
      user={{ displayName: 'Alex Rivera', email: 'alex@example.com' }}
      messages={m.chrome}
      accountNav={m.account.nav}
      initialCollapsed={opts.collapsed ?? false}
      announcement={opts.announcement ?? null}
    >
      <p>page</p>
    </AdminShell>
  );
}

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

let root: Root | undefined;
let host: HTMLDivElement | undefined;
async function mount(opts: Parameters<typeof shell>[0] & { pathname?: string } = {}) {
  nav.pathname = opts.pathname ?? '/admin';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(shell(opts)));
}
async function unmount() {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
}

/** The desktop rail and the drawer, in that order. */
const rails = (scope: ParentNode) => [...scope.querySelectorAll('aside')];
const helpButton = (rail: ParentNode) => rail.querySelector<HTMLButtonElement>('[data-testid="nav-help"]')!;
const helpList = (rail: ParentNode) => rail.querySelector<HTMLUListElement>('[data-testid="nav-help-list"]');
const flyout = () => document.querySelector<HTMLElement>('[data-testid="nav-help-flyout"]');
const click = (el: Element) => act(async () => void (el as HTMLElement).click());
const key = (el: Element, k: string, shiftKey = false) =>
  act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, shiftKey })));

beforeEach(() => {
  nav.pathname = '/admin';
  localStorage.clear();
  resetAnnouncementLoad();
  window.matchMedia = ((q: string) => ({
    matches: q.includes('min-width'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  // No layout here: a menu whose anchor measures 0x0 closes itself.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 10, y: 200, width: 44, height: 44 }),
  );
});
afterEach(async () => {
  await unmount();
  vi.restoreAllMocks();
});

describe('AdminShell: the Help group, server markup', () => {
  it('replaces Tools and Docs with one row in their place, in both rails, closed by default', () => {
    const doc = parse(renderToStaticMarkup(shell()));
    for (const rail of rails(doc)) {
      const top = [...rail.querySelectorAll('[data-testid="sidebar-nav"] > ul > li > [data-testid^="nav-"]')].map((el) =>
        el.getAttribute('data-testid'),
      );
      expect(top).not.toContain('nav-tools');
      expect(top).not.toContain('nav-docs');
      expect(top.indexOf('nav-help')).toBe(top.indexOf('nav-developers') + 1);
      expect(top[top.indexOf('nav-help') + 1]).toBe('nav-help-list');
      expect(top[top.indexOf('nav-help') + 2]).toBe('nav-playbooks');

      const button = helpButton(rail);
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
      expect(button.getAttribute('aria-expanded')).toBe('false');
      const list = helpList(rail)!;
      expect(button.getAttribute('aria-controls')).toBe(list.id);
      expect(list.hasAttribute('hidden')).toBe(true);
      expect(button.querySelector('.pi-question-circle')).not.toBeNull();
    }
  });

  it('keeps the subpages where they were: Tools in the app, Docs external in a new tab', () => {
    const doc = parse(renderToStaticMarkup(shell()));
    const [desktop] = rails(doc);
    const list = helpList(desktop!)!;
    const tools = list.querySelector('[data-testid="nav-tools"]')!;
    const docs = list.querySelector('[data-testid="nav-docs"]')!;
    expect(tools.getAttribute('href')).toBe('/admin/developers/tools');
    expect(docs.getAttribute('target')).toBe('_blank');
    expect(docs.getAttribute('href')).toContain('utm_source=forms');
    expect(docs.querySelector('.pi-external-link')).not.toBeNull();
  });

  it('is named in both languages', () => {
    expect(getMessages('en').admin.chrome.nav.help).toBe('Help');
    expect(getMessages('es').admin.chrome.nav.help).toBe('Ayuda');
    for (const locale of ['en', 'es'] as const) {
      const doc = parse(renderToStaticMarkup(shell({ locale })));
      expect(helpButton(doc).textContent).toContain(getMessages(locale).admin.chrome.nav.help);
    }
  });

  it('on a subpage, is open and marked quietly while the subpage carries the bar', () => {
    nav.pathname = '/admin/developers/tools';
    const doc = parse(renderToStaticMarkup(shell()));
    for (const rail of rails(doc)) {
      const button = helpButton(rail);
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(button.getAttribute('data-active')).toBe('true');
      expect(button.className).toContain('font-medium');
      expect(button.className).not.toContain('before:bg-primary-edge');
      expect(button.hasAttribute('aria-current')).toBe(false);
      expect(helpList(rail)!.hasAttribute('hidden')).toBe(false);
      const tools = helpList(rail)!.querySelector('[data-testid="nav-tools"]')!;
      expect(tools.getAttribute('aria-current')).toBe('page');
      expect(tools.className).toContain('before:bg-primary-edge');
    }
  });

  it('collapsed to 64px: an icon tile that opens a menu, fully marked on a subpage', () => {
    nav.pathname = '/admin/developers/tools';
    const [desktop] = rails(parse(renderToStaticMarkup(shell({ collapsed: true }))));
    const button = helpButton(desktop!);
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('title')).toBe('Help');
    expect(button.querySelector('.sr-only')!.textContent).toBe('Help');
    expect(button.className).toContain('before:bg-primary-edge');
    expect(helpList(desktop!)).toBeNull();
  });

  it('elsewhere, is not marked', () => {
    for (const pathname of ['/admin', '/admin/developers/connect', '/admin/playbooks']) {
      nav.pathname = pathname;
      for (const collapsed of [false, true]) {
        const button = helpButton(parse(renderToStaticMarkup(shell({ collapsed }))));
        expect(button.hasAttribute('data-active')).toBe(false);
        expect(button.className).not.toContain('before:bg-primary-edge');
      }
    }
  });
});

describe('AdminShell: the Help group, driven', () => {
  it('opens and closes on click, in step across both rails, and remembers it', async () => {
    await mount();
    const [desktop, drawer] = rails(host!);
    expect(helpList(desktop!)!.hidden).toBe(true);
    await click(helpButton(desktop!));
    for (const rail of [desktop!, drawer!]) {
      expect(helpButton(rail).getAttribute('aria-expanded')).toBe('true');
      expect(helpList(rail)!.hidden).toBe(false);
    }
    expect(localStorage.getItem(KEY)).toBe('1');
    await click(helpButton(drawer!));
    expect(helpList(desktop!)!.hidden).toBe(true);
    expect(localStorage.getItem(KEY)).toBe('0');
  });

  it('comes back the way the person left it on the next load', async () => {
    localStorage.setItem(KEY, '1');
    await mount();
    expect(helpButton(rails(host!)[0]!).getAttribute('aria-expanded')).toBe('true');
    await unmount();
    localStorage.setItem(KEY, '0');
    await mount();
    expect(helpButton(rails(host!)[0]!).getAttribute('aria-expanded')).toBe('false');
  });

  it('opens on a subpage even when it was left closed, without overwriting the choice', async () => {
    localStorage.setItem(KEY, '0');
    await mount({ pathname: '/admin/developers/tools' });
    expect(helpButton(rails(host!)[0]!).getAttribute('aria-expanded')).toBe('true');
    expect(localStorage.getItem(KEY)).toBe('0');
  });

  it('opens when the person navigates onto a subpage', async () => {
    await mount();
    expect(helpButton(rails(host!)[0]!).getAttribute('aria-expanded')).toBe('false');
    nav.pathname = '/admin/developers/tools';
    await act(async () => root!.render(shell()));
    expect(helpButton(rails(host!)[0]!).getAttribute('aria-expanded')).toBe('true');
  });

  it('still works when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    await mount();
    const button = helpButton(rails(host!)[0]!);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('collapsed: opens a flyout menu with focus on its first link; arrows walk it, Escape closes it', async () => {
    await mount({ collapsed: true });
    const button = helpButton(rails(host!)[0]!);
    button.focus();
    await click(button);
    const menu = flyout()!;
    expect(menu).not.toBeNull();
    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.getAttribute('aria-label')).toBe('Help');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(menu.id);
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((i) => i.getAttribute('data-testid'))).toEqual(['nav-tools', 'nav-docs']);
    expect(items[0]!.getAttribute('href')).toBe('/admin/developers/tools');
    expect(items[1]!.getAttribute('target')).toBe('_blank');
    expect(document.activeElement).toBe(items[0]);

    await key(items[0]!, 'ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    await key(items[1]!, 'ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    await key(items[0]!, 'ArrowUp');
    expect(document.activeElement).toBe(items[1]);

    await key(items[1]!, 'Escape');
    expect(flyout()).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('collapsed: Tab leaves the flyout from the group row, closing it (no focus trap)', async () => {
    await mount({ collapsed: true });
    const button = helpButton(rails(host!)[0]!);
    await click(button);
    const [first] = flyout()!.querySelectorAll<HTMLElement>('[role="menuitem"]');
    await key(first!, 'Tab');
    expect(flyout()).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('collapsed: choosing a link closes the flyout, and the subpage is marked inside it', async () => {
    await mount({ collapsed: true, pathname: '/admin/developers/tools' });
    const button = helpButton(rails(host!)[0]!);
    await click(button);
    const tools = flyout()!.querySelector<HTMLElement>('[data-testid="nav-tools"]')!;
    expect(tools.getAttribute('aria-current')).toBe('page');
    await click(tools);
    expect(flyout()).toBeNull();
  });
});

describe('AdminShell: the Help group and the "New" badge', () => {
  // No announcement points inside Help today; the group carries a child's mark
  // generically, so one aimed at Tools must still be seen.
  const TOOLS_ANN: ShellAnnouncement = {
    id: 'integrations-2026-11',
    cta: '/admin/developers/tools',
    railBadge: 'tools' as unknown as AnnouncementRailItem,
    badge: true,
    modal: false,
    followed: false,
    copy: null,
    closeLabel: 'Close',
    visual: { kind: 'video', src: '/x', width: 1280, height: 720 },
  };

  it('shows on the group while it is closed or collapsed, and on the child once the list is open', async () => {
    const closed = parse(renderToStaticMarkup(shell({ announcement: TOOLS_ANN })));
    const [desktop] = rails(closed);
    expect(helpButton(desktop!).getAttribute('data-badge')).toBe('new');
    expect(helpButton(desktop!).querySelector('[data-testid="nav-badge"]')).not.toBeNull();
    expect(helpList(desktop!)!.querySelector('[data-testid="nav-tools"]')!.getAttribute('data-badge')).toBe('new');

    const collapsed = parse(renderToStaticMarkup(shell({ announcement: TOOLS_ANN, collapsed: true })));
    const tile = helpButton(rails(collapsed)[0]!);
    expect(tile.getAttribute('data-badge')).toBe('new');
    expect(tile.querySelector('[data-testid="nav-badge-dot"]')).not.toBeNull();
    expect(tile.getAttribute('title')).toBe(`Help${getMessages('en').admin.chrome.newBadge.sr}`);

    await mount({ announcement: TOOLS_ANN });
    const button = helpButton(rails(host!)[0]!);
    await click(button);
    expect(button.hasAttribute('data-badge')).toBe(false);
  });

  it('leaves Playbooks and its own "New" exactly as they were', () => {
    const doc = parse(renderToStaticMarkup(shell()));
    expect(helpButton(doc).hasAttribute('data-badge')).toBe(false);
    expect(doc.querySelectorAll('[data-testid="nav-playbooks"]')).toHaveLength(2);
  });
});
