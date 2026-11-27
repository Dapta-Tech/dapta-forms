// @vitest-environment happy-dom
/**
 * The sidebar's three parts, in the desktop rail (open and collapsed to 64px)
 * and in the mobile drawer: a header (wordmark, workspace switcher) and a
 * footer (theme toggle, profile row) that keep their height, and between them
 * the nav, the ONLY scroll container. A menu taller than the window (with
 * "Remove badge" and the Product Hunt row it is, on a short laptop screen)
 * scrolls its items under a header and above a footer that stay where they
 * are. Before, the whole <aside> scrolled: the wheel over the rail slid the
 * profile row and the theme toggle away with the list, and left the wordmark
 * row clipped at the top of the window, with or without the referral banner.
 *
 * happy-dom does no layout, so these pin the structure and the classes that
 * produce it; the screenshots at 1280x640, 1280x900 and 390x700 are the
 * visual check.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@quill/shared';

const nav = vi.hoisted(() => ({ pathname: '/admin' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock('@/app/admin/announcement-actions', () => ({ recordAnnouncementAction: async () => ({ ok: true }) }));
vi.mock('@/app/admin/referral-actions', () => ({
  dismissReferralBanner: async () => ({ ok: true }),
  readReferralProgress: async () => null,
}));
vi.mock('@/lib/product-analytics', () => ({ captureEvent: () => {} }));

import { AdminShell, type ShellReferral } from './admin-shell';
import type { Workspace } from '@/lib/admin-api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = getMessages('en').admin;
const WORKSPACES: Workspace[] = [
  {
    accountId: 'acc-1',
    workspaceId: 'ws-1',
    accountCode: 'acme',
    accountName: 'Acme Inc.',
    memberId: 'mem-1',
    role: 'owner',
    status: 'active',
    memberCount: 1,
    accessGrant: null,
  },
];
const REFERRAL: ShellReferral = {
  link: 'https://landing.example.test/?ref=abc23def',
  count: 0,
  goal: 5,
  badgeLabel: 'Made with dForms',
};

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  nav.pathname = '/admin';
});

function mount(opts: { collapsed?: boolean; banner?: boolean; pathname?: string } = {}) {
  nav.pathname = opts.pathname ?? '/admin';
  act(() =>
    root.render(
      <AdminShell
        user={{ displayName: 'Alex Rivera', email: 'alex@example.com' }}
        messages={m.chrome}
        accountNav={m.account.nav}
        initialCollapsed={opts.collapsed ?? false}
        workspaces={WORKSPACES}
        currentAccountId="acc-1"
        referral={opts.banner ? { ...REFERRAL, banner: { badgeLabel: 'Made with dForms' } } : REFERRAL}
        productHunt
      >
        <p>page</p>
      </AdminShell>,
    ),
  );
}

const desktopRail = () => host.querySelector<HTMLElement>('aside:not([role="dialog"])')!;
const drawer = () => host.querySelector<HTMLElement>('aside[role="dialog"]')!;
const classes = (el: Element) => el.getAttribute('class')?.split(/\s+/) ?? [];
/** Overflow utilities that make an element a scroll container (at any breakpoint). */
const SCROLLS = /(^|:)overflow(-y)?-(auto|scroll)$/;
const scrolls = (el: Element) => classes(el).some((c) => SCROLLS.test(c));

/**
 * The structure every sidebar shares: header, nav, footer, in that order and
 * nothing else; only the nav scrolls; the rows of the menu are all inside it,
 * and the switcher, toggle and profile row are not.
 */
function expectPinnedLayout(aside: HTMLElement, { collapsed }: { collapsed: boolean }) {
  const parts = [...aside.children].map((el) => el.getAttribute('data-testid') ?? el.tagName.toLowerCase());
  expect(parts).toEqual(['sidebar-header', 'sidebar-nav', 'sidebar-footer']);
  const [header, navEl, footer] = [...aside.children] as [HTMLElement, HTMLElement, HTMLElement];

  // A full-height column that does not scroll itself.
  expect(classes(aside)).toContain('flex-col');
  expect(scrolls(aside)).toBe(false);

  // The nav takes what is left and is the scroll container. `min-h-0` lets a
  // flex item get shorter than its content, without it there is nothing to
  // scroll and the column overflows the window instead.
  expect(navEl.tagName).toBe('NAV');
  expect(classes(navEl)).toEqual(expect.arrayContaining(['flex-1', 'min-h-0', 'overflow-y-auto', 'no-scrollbar']));
  // The sidebar's padding becomes the scroll box's, so focus outlines and the
  // "Connect your agent" glow are not cut at its edges, and the rows do not move.
  expect(classes(navEl)).toEqual(
    expect.arrayContaining(collapsed ? ['-mx-2', 'px-2', '-my-3', 'py-3'] : ['-mx-4', 'px-4', '-my-3', 'py-3']),
  );
  expect(classes(aside).some((c) => (collapsed ? c === 'px-2' : c === 'px-4' || c === 'p-4'))).toBe(true);

  // Header and footer keep their height.
  expect(classes(header)).toContain('shrink-0');
  expect(classes(footer)).toContain('shrink-0');

  // Nothing between the sidebar and its header or footer scrolls either.
  for (const pinned of [header, footer]) {
    for (let el: HTMLElement | null = pinned; el && el !== aside; el = el.parentElement) {
      expect(scrolls(el)).toBe(false);
    }
  }

  // Where each control lives.
  expect(header.querySelector('[data-testid="workspace-switcher"]')).not.toBeNull();
  // The header is the brand row (wordmark, app switcher) over the workspace switcher.
  expect(header.children).toHaveLength(2);
  expect(header.children[0]!.childElementCount).toBeGreaterThan(0);
  expect(header.children[1]!.getAttribute('data-testid')).toBe('workspace-switcher');
  for (const id of ['nav-developers', 'nav-help', 'nav-referral', 'nav-product-hunt']) {
    expect(navEl.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
  }
  expect(navEl.querySelector('a[href="/admin"]')).not.toBeNull();
  expect(footer.querySelector('[data-testid="profile-menu-trigger"]')).not.toBeNull();
  expect(footer.querySelector(`button[aria-label]`)).not.toBeNull();
  expect(navEl.querySelector('[data-testid="profile-menu-trigger"]')).toBeNull();
  expect(navEl.querySelector('[data-testid="workspace-switcher"]')).toBeNull();
  expect(navEl.contains(footer)).toBe(false);
}

describe('AdminShell sidebar: pinned header and footer, scrolling nav', () => {
  it('the open desktop rail', () => {
    mount();
    expectPinnedLayout(desktopRail(), { collapsed: false });
  });

  it('the rail collapsed to 64px', () => {
    mount({ collapsed: true });
    expectPinnedLayout(desktopRail(), { collapsed: true });
  });

  it('the mobile drawer', () => {
    mount();
    expectPinnedLayout(drawer(), { collapsed: false });
  });

  it('the rail in the form builder (peek rail, collapsed at rest)', () => {
    mount({ pathname: '/admin/forms/f1/edit' });
    const rail = desktopRail();
    expectPinnedLayout(rail, { collapsed: true });
    // Still out of the flow and one screen tall, over a one-screen shell.
    expect(classes(rail)).toEqual(expect.arrayContaining(['md:fixed', 'md:top-0', 'md:h-dvh']));
    expect(classes(host.firstElementChild!)).toEqual(expect.arrayContaining(['h-dvh', 'overflow-hidden']));
  });

  it.each([
    ['with the referral banner', true],
    ['without it (dismissed, or a paid workspace)', false],
  ])('the rail stays one window tall and pinned to the top of the window %s', (_, banner) => {
    mount({ banner });
    expect(host.querySelector('[data-testid="referral-banner"]') !== null).toBe(banner);
    const rail = desktopRail();
    // Sticky at the top of the window while the page scrolls under it, as tall
    // as the window, and never scrolled itself, so the wordmark row cannot be
    // pushed above the top edge.
    expect(classes(rail)).toEqual(expect.arrayContaining(['md:sticky', 'md:top-0', 'md:h-dvh']));
    expectPinnedLayout(rail, { collapsed: false });
    // The banner belongs to <main>, never to the rail: no offset to keep or undo.
    expect(rail.querySelector('[data-testid="referral-banner"]')).toBeNull();
    // Other pages are as tall as their content and scroll as a page.
    expect(classes(host.firstElementChild!)).toEqual(expect.arrayContaining(['min-h-dvh']));
    expect(classes(host.firstElementChild!)).not.toContain('overflow-hidden');
  });
});
