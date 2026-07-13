import { getMessages } from '@slate/shared';
import { adminApi, isAdminRole } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { NoAccess } from '@/components/no-access';
import { ApiKeys, Webhooks } from './developer-client';

export const dynamic = 'force-dynamic';

export default async function DeveloperSettings() {
  const [me, locale] = await Promise.all([adminApi.me(), getLocale()]);
  // Developer (API keys + webhooks) is admin/owner-only — the API 403s for a
  // plain member, so gate here for a graceful message.
  if (!isAdminRole(me.role)) {
    const nm = getMessages(locale).admin.members;
    return <NoAccess title={nm.noAccessTitle} body={nm.noAccessBody} />;
  }
  const [keys, webhooks] = await Promise.all([adminApi.listApiKeys(), adminApi.listWebhooks()]);
  const m = getMessages(locale).admin.developer;
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <ApiKeys keys={keys} messages={m} />
      <Webhooks webhooks={webhooks} messages={m} />
    </div>
  );
}
