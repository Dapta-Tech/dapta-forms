'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { BookingMessages } from '@slate/shared';
import { SettingsTabs } from './settings-tabs';

type SettingsMessages = BookingMessages['admin']['settings'];

/** Settings chrome: header + sub-nav for the standard settings pages, but the
 *  booking-page STUDIO renders full-bleed with no header/sub-nav (mirrors the
 *  old app's isStudio mode — header dropped, rail collapsed for full width). */
export function SettingsChrome({
  messages,
  isAdmin,
  children,
}: {
  messages: SettingsMessages;
  isAdmin: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isStudio = pathname.startsWith('/admin/settings/booking-page');

  if (isStudio) return <>{children}</>;

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <header className="mb-6 flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">{messages.title}</h1>
        <p className="text-muted-foreground">{messages.subtitle}</p>
      </header>
      <SettingsTabs messages={messages} isAdmin={isAdmin} />
      {children}
    </div>
  );
}
