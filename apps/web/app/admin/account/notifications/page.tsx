import { getMessages } from '@quill/shared';
import { adminApi, isAdminRole } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { NotificationSettings } from './notification-settings';
import { ManagingChip } from '../_components/managing-chip';

export const dynamic = 'force-dynamic';

/**
 * Account settings → Notifications: the two submission emails (owner notice +
 * respondent confirmation). Admin/owner only; members get a muted notice in
 * place of the editor. The API is the real gate, this mirrors it so the cards
 * only render when a save would succeed.
 */
export default async function NotificationsPage() {
  const locale = await getLocale();
  const messages = getMessages(locale).admin;
  const n = messages.notifications;
  const me = await adminApi.me();

  if (!isAdminRole(me.role)) {
    return (
      <section
        data-testid="account-notifications-forbidden"
        className="rounded-xl border border-border bg-card p-6"
      >
        <h2 className="text-lg font-semibold tracking-tight">{n.heading}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{n.subtitle}</p>
        <p className="mt-4 text-sm text-muted-foreground">{messages.account.notificationsNoAccess}</p>
      </section>
    );
  }

  const notifications = await adminApi.getNotifications().catch(() => null);

  return (
    <div>
      <div className="mb-4">
        <ManagingChip label={messages.account.managing} name={me.accountName} />
      </div>
      {notifications ? (
        <NotificationSettings settings={notifications.settings} locale={locale} labels={n} />
      ) : (
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold tracking-tight">{n.heading}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{n.subtitle}</p>
          <p className="mt-4 text-sm text-muted-foreground">{messages.settings.manageErrorFailed}</p>
        </section>
      )}
    </div>
  );
}
