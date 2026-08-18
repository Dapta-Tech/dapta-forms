'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { FormsMessages } from '@quill/shared';

type NavLabels = FormsMessages['admin']['account']['nav'];

interface AccountNavItem {
  key: keyof NavLabels;
  href: string;
  /** PrimeIcons class (the design system's icon set, same as the rail). */
  icon: string;
  testId: string;
}

// The four account surfaces, in the order the sub-nav shows them. Every href is
// a prefix: /admin/account/workspaces/<id> keeps "Workspaces" lit.
const ITEMS: AccountNavItem[] = [
  { key: 'workspaces', href: '/admin/account/workspaces', icon: 'pi-th-large', testId: 'account-nav-workspaces' },
  { key: 'brandKit', href: '/admin/account/brand-kit', icon: 'pi-palette', testId: 'account-nav-brand-kit' },
  { key: 'notifications', href: '/admin/account/notifications', icon: 'pi-bell', testId: 'account-nav-notifications' },
  { key: 'publicPage', href: '/admin/account/public-page', icon: 'pi-globe', testId: 'account-nav-public-page' },
];

/**
 * The account-settings sub-nav. From `xl`: a vertical list to the left of the
 * content; below it: a 2x2 grid above the content, so every entry is visible
 * without scrolling even at 375px (a horizontal scroller hid "Public page"
 * off-screen with nothing to say so). Same visual grammar as the rail's
 * NavLinks (bg-muted wash + 2px accent bar for the active item,
 * aria-current="page") so the two navigations read as one system.
 * Client-side only for `usePathname`.
 */
export function AccountNav({ labels, ariaLabel }: { labels: NavLabels; ariaLabel: string }) {
  const pathname = usePathname();
  return (
    <nav data-testid="account-nav" aria-label={ariaLabel} className="xl:w-52 xl:shrink-0">
      <ul className="grid grid-cols-2 gap-1 sm:grid-cols-4 xl:flex xl:flex-col">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href} className="min-w-0">
              <Link
                href={item.href}
                data-testid={item.testId}
                aria-current={active ? 'page' : undefined}
                className={[
                  'relative flex min-h-[44px] items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors active:scale-[0.99]',
                  active
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  // Same two-signal marker as the rail: the wash for scanning,
                  // the accent bar for identifying (see admin-shell.tsx).
                  active &&
                    'before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary-edge before:content-[""]',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <i aria-hidden className={`pi ${item.icon}`} style={{ fontSize: 16 }} />
                <span>{labels[item.key]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
