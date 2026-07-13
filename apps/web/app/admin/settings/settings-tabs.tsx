'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { BookingMessages } from '@slate/shared';

type SettingsMessages = BookingMessages['admin']['settings'];

// Second-level settings nav: General · Booking Page · Members · Developer.
// (Calendars is a top-level nav item at /admin/connections, not a settings
// tab.) Labels resolve per-locale. Members + Developer are admin/owner-only.
const TABS: {
  key: keyof Omit<SettingsMessages, 'title' | 'subtitle'>;
  href: string;
  adminOnly?: boolean;
}[] = [
  { key: 'general', href: '/admin/settings/general' },
  { key: 'bookingPage', href: '/admin/settings/booking-page' },
  { key: 'notifications', href: '/admin/settings/notifications', adminOnly: true },
  { key: 'members', href: '/admin/settings/members', adminOnly: true },
  { key: 'developer', href: '/admin/settings/developer', adminOnly: true },
];

export function SettingsTabs({ messages, isAdmin }: { messages: SettingsMessages; isAdmin: boolean }) {
  const pathname = usePathname();
  return (
    // Horizontal, scrollable settings sub-nav. Active = raised fill + medium
    // weight (DS recipe — no accent bar), matching the main sidebar nav.
    <nav className="mb-6 flex gap-1 overflow-x-auto" aria-label="Settings">
      {TABS.filter((tab) => isAdmin || !tab.adminOnly).map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={[
              'whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors active:scale-[0.99]',
              active
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            ].join(' ')}
          >
            {messages[tab.key]}
          </Link>
        );
      })}
    </nav>
  );
}
