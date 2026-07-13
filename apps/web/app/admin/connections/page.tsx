import { getMessages } from '@slate/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { PageHeader } from '@/components/ui/page-header';
import { ConnectionsClient } from './connections-client';

export const dynamic = 'force-dynamic';

// Customer-facing name comes from the deployment (same rule as the wordmark);
// 'Slate' never surfaces in the UI.
const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Calendars';

export default async function ConnectionsPage() {
  const [connections, token] = await Promise.all([
    adminApi.listConnections(),
    // Provider status: enabled only when an external calendar adapter is wired.
    adminApi.connectionToken().catch(() => ({ enabled: false, message: 'Calendar sync unavailable.' })),
  ]);
  const admin = getMessages(await getLocale()).admin;
  const messages = {
    ...admin.connections,
    pageDesc: admin.connections.pageDesc.replace('{product}', PRODUCT_NAME),
    emptyBody: admin.connections.emptyBody.replace('{product}', PRODUCT_NAME),
  };
  // Calendars is a top-level admin surface (rail item), styled like the other
  // list pages: PageHeader + content column. The primary Connect action lives
  // inside ConnectionsClient's header row (R30 list/create pattern).
  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader title={admin.nav.calendars} subtitle={messages.pageDesc} />
      <div className="max-w-3xl">
        <ConnectionsClient
          connections={connections}
          status={{ enabled: token.enabled, message: token.message }}
          messages={messages}
        />
      </div>
    </div>
  );
}
