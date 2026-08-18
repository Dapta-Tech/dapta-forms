'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import type { FormsMessages } from '@quill/shared';
import { signOutAction } from '@/app/login/actions';
import type { ShellUser } from '@/components/admin-shell';
import { AnchoredMenu } from '@/components/ui/anchored-menu';
import { resetAnalytics } from '@/lib/product-analytics';

type Messages = FormsMessages['admin']['chrome']['profileMenu'];
type AccountNavMessages = FormsMessages['admin']['account']['nav'];

/** The account-settings entries, in the order the sub-nav shows them. */
const ACCOUNT_ITEMS: ReadonlyArray<{
  key: keyof AccountNavMessages;
  href: string;
  icon: string;
  testId: string;
}> = [
  // Workspaces keeps the historical `profile-account-settings` id: it is the
  // landing page of Account settings, and the e2e harness enters through it.
  { key: 'workspaces', href: '/admin/account/workspaces', icon: 'pi-th-large', testId: 'profile-account-settings' },
  { key: 'brandKit', href: '/admin/account/brand-kit', icon: 'pi-palette', testId: 'profile-nav-brand-kit' },
  { key: 'notifications', href: '/admin/account/notifications', icon: 'pi-bell', testId: 'profile-nav-notifications' },
  { key: 'publicPage', href: '/admin/account/public-page', icon: 'pi-globe', testId: 'profile-nav-public-page' },
];

/**
 * The bottom-left profile button and its menu — the same door Dapta's admin
 * panel puts there: avatar + name + email, opening the account settings and
 * "Log out". The account entries are listed right in the menu (under an
 * "Account settings" eyebrow) rather than behind one more click, so Brand kit
 * or Notifications are one tap away from anywhere.
 *
 * Settings left the rail on purpose. Workspaces, brand kit, notifications and
 * the public page describe the ACCOUNT, not the work; parking them behind the
 * person who owns them keeps the rail to the five surfaces you use every day
 * and matches where every other Dapta product keeps them.
 *
 * The panel renders through AnchoredMenu — a portal to document.body — because
 * the rail clips it (overflow-y-auto) and buries it under <main>'s stacking
 * context. AnchoredMenu flips the panel upward when there is no room below,
 * which is the normal case for a trigger sitting at the very bottom of the
 * rail. See anchored-menu.tsx.
 *
 * WAI-ARIA menu-button pattern, matching WorkspaceSwitcher: Escape and outside
 * click dismiss, and focus lands on the first item when it opens.
 */
export function ProfileMenu({
  user,
  collapsed,
  m,
  nav,
  onNavigate,
}: {
  user: ShellUser | null;
  /** The 64px rail renders the avatar alone; the drawer and the wide rail get the full row. */
  collapsed: boolean;
  m: Messages;
  /** Labels of the account-settings entries (shared with the area's own sub-nav). */
  nav: AccountNavMessages;
  /** Called after an entry is chosen — the mobile drawer closes itself with it. */
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  const displayName = user?.displayName?.trim() || null;
  const email = user?.email?.trim() || null;
  // First line: the name, or the address when there is no name to show. The
  // second line is the address only when it is not already the first line.
  // `user` is never null behind the /admin gate (the layout redirects on a
  // 401 before this renders); the empty string keeps the type honest.
  const primary = displayName ?? email ?? '';
  const secondary = displayName ? email : null;
  const initial = (primary.charAt(0) || 'A').toUpperCase();
  // The accessible name must CONTAIN the visible text (WCAG 2.5.3): a person
  // steering by voice says the name they see, and assistive tech should still
  // learn who is signed in. The purpose ("Account menu") rides along.
  const accessibleName = primary ? `${primary}. ${m.label}` : m.label;

  const itemClass =
    'flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none';

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        data-testid="profile-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={accessibleName}
        title={collapsed ? primary : undefined}
        className={`flex items-center gap-2 rounded-md text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] ${
          collapsed ? 'h-11 w-11 justify-center' : 'min-h-[44px] w-full px-2 py-1.5'
        }`}
      >
        <span
          aria-hidden
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-border bg-card text-xs font-semibold text-muted-foreground"
        >
          {initial}
        </span>
        {!collapsed ? (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm text-foreground" title={primary}>
                {primary}
              </span>
              {secondary ? (
                <span className="truncate text-xs text-muted-foreground" title={secondary}>
                  {secondary}
                </span>
              ) : null}
            </span>
            <i
              aria-hidden
              className={`pi ${open ? 'pi-chevron-up' : 'pi-chevron-down'} shrink-0 text-muted-foreground`}
              style={{ fontSize: 10 }}
            />
          </>
        ) : null}
      </button>

      {/* Matches the trigger in the wide rail; in the collapsed rail the trigger
          is a 44px square, so the floor keeps the labels readable. */}
      <AnchoredMenu
        anchorRef={triggerRef}
        open={open}
        onClose={close}
        label={m.label}
        width="anchor"
        minWidth={200}
        autoFocus
        className="flex flex-col overflow-hidden py-1"
        testId="profile-menu"
      >
        <p className="px-2.5 py-1 text-2xs font-medium uppercase tracking-wide text-faint">
          {m.accountSettings}
        </p>
        {ACCOUNT_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            role="menuitem"
            data-testid={item.testId}
            onClick={() => {
              close();
              onNavigate?.();
            }}
            className={itemClass}
          >
            <i aria-hidden className={`pi ${item.icon} text-muted-foreground`} style={{ fontSize: 14 }} />
            <span className="min-w-0 flex-1 truncate">{nav[item.key]}</span>
          </Link>
        ))}
        <div className="my-1 border-t border-border" role="separator" />
        {/* Sign-out: a server action clears the session cookie (and redirects to
            the WorkOS logout when that provider is active). */}
        <form action={signOutAction}>
          <button
            type="submit"
            role="menuitem"
            data-testid="profile-sign-out"
            // Drop the analytics identity BEFORE the session goes away. Without
            // this the distinct id survives in the browser and the next person to
            // sign in on this machine has their events attributed to whoever
            // logged out — a shared laptop is enough to corrupt per-user data.
            onClick={() => resetAnalytics()}
            className={itemClass}
          >
            <i aria-hidden className="pi pi-sign-out text-muted-foreground" style={{ fontSize: 14 }} />
            <span className="min-w-0 flex-1 truncate">{m.logOut}</span>
          </button>
        </form>
      </AnchoredMenu>
    </>
  );
}
