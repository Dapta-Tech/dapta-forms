import { getMessages } from '@slate/shared';
import { adminApi, isAdminRole } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { NoAccess } from '@/components/no-access';
import { hostFetch } from '@/lib/auth-session';
import { NotificationsClient, type NotificationSettingsPayload } from './notifications-client';

export const dynamic = 'force-dynamic';

export default async function NotificationsSettings() {
  const [me, locale] = await Promise.all([adminApi.me(), getLocale()]);
  const m = getMessages(locale).admin;

  // Role gate: notification controls are workspace-wide, admin/owner-only.
  if (!isAdminRole(me.role)) {
    return <NoAccess title={m.members.noAccessTitle} body={m.members.noAccessBody} />;
  }

  const res = await hostFetch('/v1/notification-settings');
  if (!res.ok) throw new Error('Failed to load notification settings.');
  const data = (await res.json()) as NotificationSettingsPayload;

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{m.notifications.title}</h2>
        <p className="text-sm text-muted-foreground">{m.notifications.subtitle}</p>
      </div>
      <NotificationsClient data={data} messages={m.notifications} />
    </div>
  );
}
