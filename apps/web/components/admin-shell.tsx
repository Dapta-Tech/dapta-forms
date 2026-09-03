'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isNavItemActive, type FormsMessages } from '@quill/shared';
import { AppSwitcher } from '@/components/app-switcher';
import { BrandMark, BrandWordmark } from '@/components/brand/brand';
import { ProfileMenu } from '@/components/profile-menu';
import { ThemeToggle } from '@/components/theme-toggle';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';
import type { Workspace } from '@/lib/admin-api';
import { PLATFORM_URL, suiteHref } from '@/lib/suite';
import type { ThemePref } from '@/lib/theme';

type ChromeMessages = FormsMessages['admin']['chrome'];

/** Design-parity admin shell — a direct port of Dapta Calendars' AppShell so the
 *  two products read as one family: a flush 240px sidebar (bg-popover, right
 *  border, never a floating card), a flat icon+label nav, a bottom user footer,
 *  a desktop collapse rail (cookie-persisted, no FOUC), and a <768px off-canvas
 *  drawer with a hamburger top bar. Tokens only; R22 press/hover; R27/R28. */

type IconName = 'home' | 'forms' | 'submissions' | 'analytics' | 'integrations' | 'docs' | 'agents';

interface NavItem {
  key: keyof ChromeMessages['nav'];
  href: string;
  icon: IconName;
  /** Active when the path matches any of these (prefix) in addition to href. */
  match?: string[];
  /** Leaves the app: plain anchor in a new tab, never `aria-current`. */
  external?: true;
  /**
   * The href comes from the localized catalog instead of `href` (the docs
   * site has one page per language). `NavLinks` resolves it from `docsHref`.
   */
  localizedHref?: 'docsHref';
}

// Forms information architecture: Home, Forms, Submissions, Analytics,
// Integrations. Submissions/Analytics/Integrations are per-form surfaces
// reached through a form picker at their global route. Everything about the
// ACCOUNT (workspaces, brand kit, notifications, public page) lives behind the
// profile button at the bottom of the rail, under /admin/account, the same
// place Dapta's admin panel keeps it, so no rail item is active on those pages.
//
// Then "Docs": the product documentation, always present, in the reader's
// language (the URL lives in the message catalog, see `docsHref`). External
// like the platform door below, and tagged the same way.
//
// Last, and only on a deployment that has a platform: "Dapta Agents", the door
// to the wider platform. It sits IN the nav rather than in a separate block so
// the rail reads as one list, and it takes the external-link affordance so it
// is never mistaken for a page of this app. Same open-core gate as the
// app-switcher's first row: with NEXT_PUBLIC_PLATFORM_URL unset a fork's rail
// carries no dead item. Same helper too, so both doors tag themselves alike
// (`utm_source=forms`, medium = the piece of chrome clicked).
const NAV: NavItem[] = [
  { key: 'home', href: '/admin', icon: 'home' },
  { key: 'forms', href: '/admin/forms', icon: 'forms' },
  { key: 'submissions', href: '/admin/submissions', icon: 'submissions' },
  { key: 'analytics', href: '/admin/analytics', icon: 'analytics' },
  { key: 'integrations', href: '/admin/integrations', icon: 'integrations' },
  { key: 'docs', href: '', icon: 'docs', external: true, localizedHref: 'docsHref' },
  ...(PLATFORM_URL
    ? [{ key: 'agents', href: suiteHref(PLATFORM_URL, 'sidebar'), icon: 'agents', external: true } as const]
    : []),
];

const NAV_COLLAPSED_KEY = 'forms.nav.collapsed';

// Dapta's icon system is PrimeIcons (pi pi-*) — the same set Calendars + the
// production admin panel use. Sized at the design-system's 20px sidebar icon.
const PI_BY_NAME: Record<IconName, string> = {
  home: 'pi-home',
  forms: 'pi-file-edit',
  submissions: 'pi-inbox',
  analytics: 'pi-chart-bar',
  integrations: 'pi-link',
  docs: 'pi-book',
  agents: 'pi-microchip-ai',
};

function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <i
      aria-hidden
      className={`pi ${PI_BY_NAME[name]}${className ? ` ${className}` : ''}`}
      style={{ fontSize: 20 }}
    />
  );
}

function NavLinks({
  collapsed,
  nav,
  docsHref,
  newTab,
  onNavigate,
}: {
  collapsed: boolean;
  nav: ChromeMessages['nav'];
  /** The localized documentation URL, already UTM-tagged by the caller. */
  docsHref: string;
  /** "(opens in a new tab)" — read out after an external item's label. */
  newTab: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-1">
      {NAV.map((item) => {
        const href = item.localizedHref ? docsHref : item.href;
        // An external item is never "here": its href is another origin, so the
        // prefix rule could not match anyway, but the intent should not depend
        // on that accident.
        const active = !item.external && isNavItemActive(pathname, href, item.match);
        const label = nav[item.key];
        const className = [
          'relative flex items-center gap-3 rounded-md text-sm transition-colors active:scale-[0.99]',
          collapsed ? 'mx-auto h-11 w-11 justify-center gap-0 px-0' : 'min-h-[44px] px-3 py-2.5',
          active
            ? 'bg-muted font-medium text-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          // The `bg-muted` wash alone cannot mark "you are here": on paper it
          // is 1.18:1 against the card behind it, well under the 3:1 WCAG
          // 1.4.11 asks of a state indicator, and a grey chip on white can
          // never reach it. The wash still does the scanning work; this 2px
          // accent bar does the identifying, at 3.3:1 on light and 14:1 on
          // dark. Two signals, so neither has to carry the whole job.
          active &&
            'before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary-edge before:content-[""]',
        ]
          .filter(Boolean)
          .join(' ');
        // Label stays in the a11y tree when collapsed (sr-only) so the
        // icon-only link keeps a discernible name (WCAG 4.1.2).
        const body = (
          <>
            <Icon name={item.icon} />
            <span className={collapsed ? 'sr-only' : ''}>{label}</span>
          </>
        );
        return (
          <li key={item.key}>
            {item.external ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onNavigate}
                title={collapsed ? label : undefined}
                data-testid={`nav-${item.key}`}
                className={className}
              >
                {body}
                {/* The same trailing arrow the app-switcher rows carry, so
                    "leaves the app" reads the same wherever it appears. Hidden
                    on the 64px rail, where the 44px tile is the icon alone. */}
                {!collapsed ? (
                  <i
                    aria-hidden
                    className="pi pi-external-link ml-auto text-muted-foreground"
                    style={{ fontSize: 13 }}
                  />
                ) : null}
                <span className="sr-only"> {newTab}</span>
              </a>
            ) : (
              <Link
                href={href}
                onClick={onNavigate}
                title={collapsed ? label : undefined}
                aria-current={active ? 'page' : undefined}
                className={className}
              >
                {body}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export interface ShellUser {
  displayName: string | null;
  email: string | null;
}

export function AdminShell({
  user,
  messages,
  accountNav,
  initialCollapsed = false,
  themePref = 'dark',
  workspaces = [],
  currentAccountId,
  staff = false,
  children,
}: {
  user: ShellUser | null;
  /** Active-locale chrome catalog — nav + common labels + switcher. */
  messages: ChromeMessages;
  /** Labels of the account-settings entries the profile menu lists. */
  accountNav: FormsMessages['admin']['account']['nav'];
  /** Server-read cookie value → no collapse-rail FOUC on reload. */
  initialCollapsed?: boolean;
  /** Server-read colour-scheme choice, so the toggle's icon matches the paint. */
  themePref?: ThemePref;
  /** Every account the caller can enter. Fewer than two renders no switcher. */
  workspaces?: Workspace[];
  /** The account these pages are currently scoped to. */
  currentAccountId?: string;
  /** Staff of the deployment: the switcher's search reaches the whole estate. */
  staff?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);

  // The form builder wants the widest canvas → force the rail collapsed on the
  // editor route (Calendars' studio parity), without touching the saved pref.
  const studio = /^\/admin\/forms\/[^/]+\/edit/.test(pathname);
  const railCollapsed = collapsed || studio;

  // Persist the desktop rail preference to a cookie so the SERVER renders the
  // correct width on the next load (no flash) — see AdminLayout.
  const toggleCollapse = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(NAV_COLLAPSED_KEY, next ? '1' : '0');
        const secure = window.location.protocol === 'https:' ? '; secure' : '';
        document.cookie = `${NAV_COLLAPSED_KEY}=${next ? '1' : '0'}; path=/; max-age=31536000; samesite=lax${secure}`;
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // Lock body scroll + close on Escape + move focus into the drawer on open (R28).
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    if (drawerOpen) drawerRef.current?.querySelector<HTMLElement>('a,button')?.focus();
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [drawerOpen]);

  const brand = (
    // px-3 matches the nav links' own padding, so the wordmark's left edge lands
    // on the same column as the nav icons instead of hanging 3.5px outside it.
    <div className={`flex items-center gap-2 ${railCollapsed ? 'flex-col px-0' : 'px-3'}`}>
      {/* Inside the app the shell already says Dapta, so the rail carries the
          product wordmark alone — at ~3:1 it reads at a size where the 6:1 full
          lockup turns to mush. Collapsed to 64px, only the mark fits. */}
      {railCollapsed ? (
        <BrandMark className="h-6 w-auto text-foreground" labelled />
      ) : (
        <BrandWordmark className="h-6 w-auto text-foreground" labelled />
      )}
      <AppSwitcher messages={messages.switcher} />
      {/* The rail toggle is a desktop pref; hidden on the editor route where the
          rail is force-collapsed for canvas. */}
      {!studio ? (
        <button
          type="button"
          onClick={toggleCollapse}
          data-testid="rail-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? messages.expand : messages.collapse}
          title={collapsed ? messages.expand : messages.collapse}
          className={`hidden rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[0.98] md:inline-flex ${collapsed ? '' : 'ml-auto'}`}
        >
          <i aria-hidden className={`pi ${collapsed ? 'pi-angle-double-right' : 'pi-angle-double-left'}`} style={{ fontSize: 16 }} />
        </button>
      ) : null}
    </div>
  );

  // The footer is two rows: the theme toggle above, the profile button last.
  // The profile button is the door to Account settings and Log out (see
  // profile-menu.tsx) — the loose "view public page" and "sign out" icons that
  // used to sit beside the toggle are gone, so the identity row no longer has
  // to share its width with a strip of 44px targets. The address gets the full
  // rail; the toggle keeps its own row so it stays a 44px hit target (R28).
  // The mobile drawer is always full-width, so its footer renders expanded
  // regardless of the DESKTOP rail state — hence a param, not the shared const.
  // `onNavigate` lets the drawer close itself when an account entry is chosen.
  const renderFooter = (footerCollapsed: boolean, onNavigate?: () => void) => (
    <div
      className={`mt-auto flex flex-col border-t border-border pt-3 ${
        footerCollapsed ? 'items-center gap-1' : 'gap-1'
      }`}
    >
      {/* Icon actions stay reachable in the collapsed rail too. */}
      <span className="flex items-center">
        <ThemeToggle pref={themePref} m={messages.theme} />
      </span>
      <ProfileMenu
        user={user}
        collapsed={footerCollapsed}
        m={messages.profileMenu}
        nav={accountNav}
        onNavigate={onNavigate}
      />
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Mobile top bar (<768px). Inert while the drawer is open so focus can't
          escape the modal (WCAG 2.4.3 / APG modal-dialog). */}
      <header
        inert={drawerOpen || undefined}
        className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-popover px-3 py-2 md:hidden"
      >
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label={messages.openNav}
          aria-expanded={drawerOpen}
          className="flex h-11 w-11 items-center justify-center rounded-md text-foreground hover:bg-muted active:scale-[0.98]"
        >
          <i aria-hidden className="pi pi-bars" style={{ fontSize: 20 }} />
        </button>
        {/* Under 360px the hamburger plus the wordmark crowds the bar, so the
            mark takes over. Done in CSS rather than JS so there is no flash on
            first paint and no resize listener. Only the visible one is display:
            block, so only one accessible name reaches the a11y tree. */}
        <BrandWordmark className="hidden h-6 w-auto text-foreground min-[360px]:block" labelled />
        <BrandMark className="h-6 w-auto text-foreground min-[360px]:hidden" labelled />
      </header>

      {/* Desktop sidebar — flush, bordered, collapsible rail.
          Pinned to the viewport (`sticky h-dvh`) rather than left to stretch
          with the page. As a plain flex item it grew to the FULL document
          height — 2834px on Settings — which dragged the `mt-auto` footer, and
          with it the account name and sign-out, ~2000px below the fold. The
          editor never showed the bug only because that route is its own
          `h-[100dvh] overflow-hidden` shell. `overflow-y-auto` keeps the rail
          usable if the nav ever outgrows a short viewport. */}
      <aside
        className={`hidden shrink-0 flex-col gap-6 border-r border-border bg-popover py-4 transition-[width] md:sticky md:top-0 md:flex md:h-dvh md:overflow-y-auto ${
          railCollapsed ? 'w-[64px] px-2' : 'w-60 px-4'
        }`}
      >
        {brand}
        {/* Directly under the wordmark and above the nav: which tenant every
            link below belongs to, and where a new one is made. Always
            rendered: "New workspace" has to exist before there is a second
            workspace to switch to. */}
        {currentAccountId ? (
          <WorkspaceSwitcher
            workspaces={workspaces}
            currentAccountId={currentAccountId}
            collapsed={railCollapsed}
            staff={staff}
            m={messages.workspaces}
          />
        ) : null}
        <nav aria-label="Primary">
          <NavLinks
            collapsed={railCollapsed}
            nav={messages.nav}
            docsHref={suiteHref(messages.docsHref, 'sidebar')}
            newTab={messages.switcher.opensNewTab}
          />
        </nav>
        {renderFooter(railCollapsed)}
      </aside>

      {/* Mobile drawer + backdrop */}
      {drawerOpen ? (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-background/80 md:hidden"
        />
      ) : null}
      <aside
        ref={drawerRef}
        className={`fixed inset-y-0 left-0 z-50 flex w-[82vw] max-w-[320px] flex-col gap-6 overflow-y-auto border-r border-border bg-popover p-4 transition-transform md:hidden ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        role="dialog"
        aria-label="Primary"
        // Containment is `inert` on everything else, NOT aria-modal. The rail's
        // popup menus render through a portal at the end of <body> — they have
        // to, or the drawer's own overflow clips them (see anchored-menu.tsx) —
        // and aria-modal means "hide everything outside this subtree", which
        // would hide those menus from assistive tech on mobile and nowhere
        // else. While the drawer is open the header and <main> are inert and
        // the desktop rail is display:none, so the only things reachable are
        // the drawer and the menu it opened. That is the containment aria-modal
        // was there to express, minus the collateral damage.
        inert={!drawerOpen || undefined}
      >
        <div className="flex items-center gap-2 px-2">
          {/* The drawer is 82vw capped at 320px, so the wordmark always fits. */}
          <BrandWordmark className="h-6 w-auto text-foreground" labelled />
          <AppSwitcher messages={messages.switcher} />
        </div>
        {currentAccountId ? (
          <WorkspaceSwitcher
            workspaces={workspaces}
            currentAccountId={currentAccountId}
            staff={staff}
            m={messages.workspaces}
          />
        ) : null}
        <nav>
          <NavLinks
            collapsed={false}
            nav={messages.nav}
            docsHref={suiteHref(messages.docsHref, 'sidebar')}
            newTab={messages.switcher.opensNewTab}
            onNavigate={() => setDrawerOpen(false)}
          />
        </nav>
        {renderFooter(false, () => setDrawerOpen(false))}
      </aside>

      <main inert={drawerOpen || undefined} className="min-w-0 flex-1 bg-background">
        {children}
      </main>
    </div>
  );
}
