'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isNavItemActive, type FormsMessages } from '@quill/shared';
import { signOutAction } from '@/app/login/actions';
import { AppSwitcher } from '@/components/app-switcher';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';
import type { Workspace } from '@/lib/admin-api';

type ChromeMessages = FormsMessages['admin']['chrome'];

/** Design-parity admin shell — a direct port of Dapta Calendars' AppShell so the
 *  two products read as one family: a flush 240px sidebar (bg-popover, right
 *  border, never a floating card), a flat icon+label nav, a bottom user footer,
 *  a desktop collapse rail (cookie-persisted, no FOUC), and a <768px off-canvas
 *  drawer with a hamburger top bar. Tokens only; R22 press/hover; R27/R28. */

type IconName = 'home' | 'forms' | 'submissions' | 'analytics' | 'integrations' | 'branding' | 'cog';

interface NavItem {
  key: keyof ChromeMessages['nav'];
  href: string;
  icon: IconName;
  /** Active when the path matches any of these (prefix) in addition to href. */
  match?: string[];
}

// Forms information architecture: Home, Forms, Submissions, Analytics,
// Integrations, Settings. Submissions/Analytics/Integrations are per-form
// surfaces reached through a form picker at their global route.
const NAV: NavItem[] = [
  { key: 'home', href: '/admin', icon: 'home' },
  { key: 'forms', href: '/admin/forms', icon: 'forms' },
  { key: 'submissions', href: '/admin/submissions', icon: 'submissions' },
  { key: 'analytics', href: '/admin/analytics', icon: 'analytics' },
  { key: 'integrations', href: '/admin/integrations', icon: 'integrations' },
  { key: 'branding', href: '/admin/branding', icon: 'branding' },
  { key: 'settings', href: '/admin/settings', icon: 'cog' },
];

const NAV_COLLAPSED_KEY = 'forms.nav.collapsed';
// Customer-facing name (build-time inlined); the codename never surfaces.
const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Forms';

// Dapta's icon system is PrimeIcons (pi pi-*) — the same set Calendars + the
// production admin panel use. Sized at the design-system's 20px sidebar icon.
const PI_BY_NAME: Record<IconName, string> = {
  home: 'pi-home',
  forms: 'pi-file-edit',
  submissions: 'pi-inbox',
  analytics: 'pi-chart-bar',
  integrations: 'pi-link',
  branding: 'pi-palette',
  cog: 'pi-cog',
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
  onNavigate,
}: {
  collapsed: boolean;
  nav: ChromeMessages['nav'];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-1">
      {NAV.map((item) => {
        const active = isNavItemActive(pathname, item.href, item.match);
        const label = nav[item.key];
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              title={collapsed ? label : undefined}
              aria-current={active ? 'page' : undefined}
              className={[
                'flex items-center gap-3 rounded-md text-sm transition-colors active:scale-[0.99]',
                collapsed ? 'mx-auto h-11 w-11 justify-center gap-0 px-0' : 'min-h-[44px] px-3 py-2.5',
                active
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              ].join(' ')}
            >
              <Icon name={item.icon} />
              {/* Label stays in the a11y tree when collapsed (sr-only) so the
                  icon-only link keeps a discernible name (WCAG 4.1.2). */}
              <span className={collapsed ? 'sr-only' : ''}>{label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

interface ShellUser {
  displayName: string | null;
  handle: string | null;
  accountCode: string;
}

export function AdminShell({
  user,
  messages,
  initialCollapsed = false,
  workspaces = [],
  currentAccountId,
  children,
}: {
  user: ShellUser | null;
  /** Active-locale chrome catalog — nav + common labels + switcher. */
  messages: ChromeMessages;
  /** Server-read cookie value → no collapse-rail FOUC on reload. */
  initialCollapsed?: boolean;
  /** Every account the caller can enter. Fewer than two renders no switcher. */
  workspaces?: Workspace[];
  /** The account these pages are currently scoped to. */
  currentAccountId?: string;
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

  const initial = (user?.displayName?.trim()?.charAt(0) || 'A').toUpperCase();
  const userLabel = user?.displayName ?? 'Not signed in';

  const brand = (
    <div className={`flex items-center gap-2 ${railCollapsed ? 'flex-col px-0' : 'px-2'}`}>
      <span className="rounded-md bg-primary px-2 py-0.5 text-sm font-semibold text-primary-foreground">
        {PRODUCT_NAME.charAt(0)}
      </span>
      {!railCollapsed ? <span className="text-sm font-semibold text-foreground">{PRODUCT_NAME}</span> : null}
      <AppSwitcher messages={messages.switcher} />
      {/* The rail toggle is a desktop pref; hidden on the editor route where the
          rail is force-collapsed for canvas. */}
      {!studio ? (
        <button
          type="button"
          onClick={toggleCollapse}
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

  // The mobile drawer is always full-width, so its footer renders expanded
  // regardless of the DESKTOP rail state — hence a param, not the shared const.
  const viewPublic = user?.handle ? (
    <Link
      href={`/${user.accountCode}/${user.handle}`}
      target="_blank"
      rel="noopener noreferrer"
      title={messages.viewPublic}
      aria-label={`${messages.viewPublic} (opens in a new tab)`}
      className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[0.98]"
    >
      <i aria-hidden className="pi pi-external-link" style={{ fontSize: 16 }} />
    </Link>
  ) : null;

  // Sign-out: a server action clears the session cookie (and redirects to the
  // WorkOS logout when that provider is active).
  const signOut = (
    <form action={signOutAction}>
      <button
        type="submit"
        title={messages.signOut}
        aria-label={messages.signOut}
        className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[0.98]"
      >
        <i aria-hidden className="pi pi-sign-out" style={{ fontSize: 16 }} />
      </button>
    </form>
  );

  const renderFooter = (footerCollapsed: boolean) => (
    <div
      className={`mt-auto grid items-center gap-2 border-t border-border pt-3 ${
        footerCollapsed ? 'grid-cols-1 justify-items-center' : 'grid-cols-[30px_1fr_auto]'
      }`}
    >
      <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-border bg-card text-xs font-semibold text-muted-foreground">
        {initial}
      </span>
      {!footerCollapsed ? (
        <span className="truncate text-sm text-foreground" title={userLabel}>
          {userLabel}
        </span>
      ) : null}
      {/* Icon actions stay reachable in the collapsed rail too. */}
      <span className={`flex items-center ${footerCollapsed ? 'flex-col gap-1' : 'gap-0.5'}`}>
        {viewPublic}
        {signOut}
      </span>
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
        <span className="rounded-md bg-primary px-2 py-0.5 text-sm font-semibold text-primary-foreground">
          {PRODUCT_NAME.charAt(0)}
        </span>
        <span className="text-sm font-semibold">{PRODUCT_NAME}</span>
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
            link below belongs to. It renders nothing at all for the single-
            workspace majority. */}
        {currentAccountId ? (
          <WorkspaceSwitcher
            workspaces={workspaces}
            currentAccountId={currentAccountId}
            collapsed={railCollapsed}
            m={messages.workspaces}
          />
        ) : null}
        <nav aria-label="Primary">
          <NavLinks collapsed={railCollapsed} nav={messages.nav} />
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
        aria-modal="true"
        aria-label="Primary"
        inert={!drawerOpen || undefined}
      >
        <div className="flex items-center gap-2 px-2">
          <span className="rounded-md bg-primary px-2 py-0.5 text-sm font-semibold text-primary-foreground">
            {PRODUCT_NAME.charAt(0)}
          </span>
          <span className="text-sm font-semibold text-foreground">{PRODUCT_NAME}</span>
          <AppSwitcher messages={messages.switcher} />
        </div>
        {currentAccountId ? (
          <WorkspaceSwitcher
            workspaces={workspaces}
            currentAccountId={currentAccountId}
            m={messages.workspaces}
          />
        ) : null}
        <nav>
          <NavLinks collapsed={false} nav={messages.nav} onNavigate={() => setDrawerOpen(false)} />
        </nav>
        {renderFooter(false)}
      </aside>

      <main inert={drawerOpen || undefined} className="min-w-0 flex-1 bg-background">
        {children}
      </main>
    </div>
  );
}
