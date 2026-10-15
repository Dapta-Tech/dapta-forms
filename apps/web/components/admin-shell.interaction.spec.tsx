// @vitest-environment happy-dom
/**
 * The MCP group (keyed `developers`), driven like a person would: the accordion in the wide
 * rail and in the mobile drawer, and the flyout on the collapsed rail (a menu
 * portalled to <body>, walked with the arrow keys and closed with Escape).
 */
import { act, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@quill/shared';

const nav = vi.hoisted(() => ({ pathname: '/admin' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
// No app router is mounted here, so a plain anchor that does not navigate.
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

import { AdminShell } from './admin-shell';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = getMessages('en').admin;
let root: Root;
let host: HTMLDivElement;

function Shell({ collapsed }: { collapsed: boolean }) {
  return (
    <AdminShell
      user={{ displayName: 'Alex Rivera', email: 'alex@example.com' }}
      messages={m.chrome}
      accountNav={m.account.nav}
      initialCollapsed={collapsed}
    >
      <p>page</p>
    </AdminShell>
  );
}

async function mount(pathname: string, collapsed = false) {
  nav.pathname = pathname;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Shell collapsed={collapsed} />));
}

/** The desktop rail and the drawer, in DOM order. */
const rail = () => host.querySelectorAll('aside')[0]!;
const drawer = () => host.querySelectorAll('aside')[1]!;
const trigger = (scope: Element) => scope.querySelector<HTMLButtonElement>('[data-testid="nav-developers"]')!;
const pages = (scope: Element) => scope.querySelector('[data-testid="nav-developers-pages"]');
const flyout = () => document.querySelector<HTMLElement>('[data-testid="nav-developers-flyout"]');
const items = () => Array.from(flyout()?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]') ?? []);
const key = (target: Element, k: string) =>
  act(async () => void target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));

beforeEach(() => {
  // No layout here: a menu whose anchor measures 0x0 closes itself (the
  // trigger is hidden), so every element gets a size.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 10, y: 200, width: 44, height: 44 }),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('MCP on the wide rail', () => {
  it('opens and closes the accordion, off its routes', async () => {
    await mount('/admin/forms');
    const b = trigger(rail());
    expect(b.getAttribute('aria-expanded')).toBe('false');
    expect(pages(rail())).toBeNull();

    await act(async () => b.click());
    expect(b.getAttribute('aria-expanded')).toBe('true');
    const list = pages(rail())!;
    expect(b.getAttribute('aria-controls')).toBe(list.id);
    const links = Array.from(list.querySelectorAll('a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/admin/developers/keys', '/admin/developers/docs']);
    expect(links.map((a) => a.textContent)).toEqual([m.chrome.developersMenu.keys, m.chrome.developersMenu.docs]);
    expect(links.some((a) => a.hasAttribute('aria-current'))).toBe(false);

    await act(async () => b.click());
    expect(b.getAttribute('aria-expanded')).toBe('false');
    expect(pages(rail())).toBeNull();
  });

  it('opens on its own when the route moves into the group', async () => {
    await mount('/admin/forms');
    expect(pages(rail())).toBeNull();
    nav.pathname = '/admin/developers/docs';
    await act(async () => root.render(<Shell collapsed={false} />));
    const docs = pages(rail())!.querySelector('a[href="/admin/developers/docs"]')!;
    expect(docs.getAttribute('aria-current')).toBe('page');
  });

  it('gives the parent the full mark once its open accordion is closed by hand', async () => {
    await mount('/admin/developers/keys');
    const b = trigger(rail());
    expect(b.className).not.toContain('before:bg-primary-edge');
    await act(async () => b.click());
    expect(pages(rail())).toBeNull();
    // The page that was marked is out of sight, so the parent takes the mark.
    expect(b.className).toContain('before:bg-primary-edge');
  });

  it('opens no flyout', async () => {
    await mount('/admin');
    await act(async () => trigger(rail()).click());
    expect(flyout()).toBeNull();
  });
});

describe('MCP on the collapsed rail', () => {
  it('opens a flyout outside the rail, beside the icon, with both pages', async () => {
    await mount('/admin/developers/keys', true);
    const b = trigger(rail());
    expect(b.getAttribute('aria-haspopup')).toBe('menu');
    await act(async () => b.click());

    const panel = flyout()!;
    expect(panel).not.toBeNull();
    expect(b.getAttribute('aria-expanded')).toBe('true');
    // Portalled: not inside the rail, whose stacking context would bury it.
    expect(rail().contains(panel)).toBe(false);
    expect(panel.getAttribute('role')).toBe('menu');
    expect(panel.getAttribute('aria-label')).toBe(m.chrome.nav.developers);
    // Beside the 44px icon (x 10 + 44 + 6px gap), top-aligned with it.
    expect(panel.style.left).toBe('60px');
    expect(panel.style.top).toBe('200px');

    expect(items().map((a) => a.getAttribute('href'))).toEqual([
      '/admin/developers/keys',
      '/admin/developers/docs',
    ]);
    expect(items()[0]!.getAttribute('aria-current')).toBe('page');
    expect(items()[1]!.hasAttribute('aria-current')).toBe(false);
    // The accordion stays out of the 64px rail.
    expect(pages(rail())).toBeNull();
  });

  it('walks the items with the arrow keys and closes on Escape, handing focus back', async () => {
    await mount('/admin', true);
    const b = trigger(rail());
    b.focus();
    await act(async () => b.click());
    expect(document.activeElement).toBe(items()[0]);

    await key(items()[0]!, 'ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    await key(items()[1]!, 'ArrowDown');
    expect(document.activeElement).toBe(items()[0]);
    await key(items()[0]!, 'ArrowUp');
    expect(document.activeElement).toBe(items()[1]);
    await key(items()[1]!, 'Home');
    expect(document.activeElement).toBe(items()[0]);

    await key(items()[0]!, 'Escape');
    expect(flyout()).toBeNull();
    expect(b.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(b);
  });

  it('closes once a page is chosen', async () => {
    await mount('/admin', true);
    await act(async () => trigger(rail()).click());
    await act(async () => items()[1]!.click());
    expect(flyout()).toBeNull();
  });

  it('closes when the trigger is clicked again', async () => {
    await mount('/admin', true);
    const b = trigger(rail());
    await act(async () => b.click());
    expect(flyout()).not.toBeNull();
    await act(async () => b.click());
    expect(flyout()).toBeNull();
  });
});

describe('MCP in the mobile drawer', () => {
  it('is the same accordion, and choosing a page closes the drawer', async () => {
    await mount('/admin', true);
    const open = host.querySelector<HTMLButtonElement>(`button[aria-label="${m.chrome.openNav}"]`)!;
    await act(async () => open.click());
    expect(drawer().className).toContain('translate-x-0');

    // The drawer is full width whatever the desktop rail is doing.
    const b = trigger(drawer());
    expect(b.hasAttribute('aria-haspopup')).toBe(false);
    await act(async () => b.click());
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(flyout()).toBeNull();

    await act(async () => pages(drawer())!.querySelector<HTMLAnchorElement>('a[href="/admin/developers/docs"]')!.click());
    expect(drawer().className).toContain('-translate-x-full');
  });
});

describe('MCP icon under the pointer', () => {
  const activeLogo = (scope: Element) =>
    trigger(scope).querySelector('[data-active="true"]')?.getAttribute('data-logo');

  it('holds the logo still while the pointer is on the row, in both rail widths', async () => {
    vi.useFakeTimers();
    try {
      for (const collapsed of [false, true]) {
        await mount('/admin', collapsed);
        const b = trigger(rail());
        expect(activeLogo(rail())).toBe('claude');
        await act(async () => void vi.advanceTimersByTime(2600));
        expect(activeLogo(rail())).toBe('openai');

        await act(async () => void b.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
        await act(async () => void vi.advanceTimersByTime(2600 * 3));
        expect(activeLogo(rail())).toBe('openai');

        await act(async () => void b.dispatchEvent(new PointerEvent('pointerout', { bubbles: true })));
        await act(async () => void vi.advanceTimersByTime(2600));
        expect(activeLogo(rail())).toBe('cursor');
        await act(async () => root.unmount());
        host.remove();
      }
      // afterEach unmounts once more.
      await mount('/admin');
    } finally {
      vi.useRealTimers();
    }
  });
});
