import type { ReactNode } from 'react';
import { getMessages } from '@slate/shared';
import { adminApi, isAdminRole } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { SettingsChrome } from './settings-chrome';

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const [me, locale] = await Promise.all([adminApi.me(), getLocale()]);
  const messages = getMessages(locale).admin.settings;
  // Admin-only tabs (Members, Developer) are hidden from plain members.
  return (
    <SettingsChrome messages={messages} isAdmin={isAdminRole(me.role)}>
      {children}
    </SettingsChrome>
  );
}
