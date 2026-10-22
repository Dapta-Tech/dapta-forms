// @vitest-environment happy-dom
/**
 * "Connect your agent" (keyed `developers`), driven like a person would: its
 * rotating logos hold still under the pointer, in both rail widths.
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
import { MCP_ROTATE_MS } from './mcp-logos';

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

/** The desktop rail (the drawer is the second aside). */
const rail = () => host.querySelectorAll('aside')[0]!;
const trigger = (scope: Element) => scope.querySelector<HTMLAnchorElement>('[data-testid="nav-developers"]')!;

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

describe('Connect your agent: the icon under the pointer', () => {
  const activeLogo = (scope: Element) =>
    trigger(scope).querySelector('[data-active="true"]')?.getAttribute('data-logo');

  it('holds the logo still while the pointer is on the row, in both rail widths', async () => {
    vi.useFakeTimers();
    try {
      for (const collapsed of [false, true]) {
        await mount('/admin', collapsed);
        const b = trigger(rail());
        expect(activeLogo(rail())).toBe('claude');
        await act(async () => void vi.advanceTimersByTime(MCP_ROTATE_MS));
        expect(activeLogo(rail())).toBe('openai');

        await act(async () => void b.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
        await act(async () => void vi.advanceTimersByTime(MCP_ROTATE_MS * 3));
        expect(activeLogo(rail())).toBe('openai');

        await act(async () => void b.dispatchEvent(new PointerEvent('pointerout', { bubbles: true })));
        await act(async () => void vi.advanceTimersByTime(MCP_ROTATE_MS));
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
