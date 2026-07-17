import { unstable_rethrow } from 'next/navigation';
import { getMessages } from '@quill/shared';
import { adminApi, type IntegrationsResponse } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { PageHeader } from '@/components/ui/page-header';
import { ConnectionsPanel } from './connections-panel';

export const dynamic = 'force-dynamic';

/**
 * Account-level Connections (Typeform's "General" tab): connect HubSpot and
 * Calendly once per account, then map fields per form. Reworked from the old
 * form-picker — per-form CRM/webhook mapping is reached from each form's own
 * integrations tab (the forms list → row menu → Integrations).
 */
export default async function ConnectionsPage() {
  const locale = await getLocale();
  const c = getMessages(locale).admin.connections;

  let data: IntegrationsResponse = { encryptionAvailable: false, providers: [] };
  let loadError = false;
  try {
    data = await adminApi.listIntegrations();
  } catch (e) {
    unstable_rethrow(e); // let a 401→redirect (or notFound) escape the catch
    loadError = true;
  }

  return (
    <div className="mx-auto max-w-[1520px] px-6 py-10 sm:px-8">
      <PageHeader title={c.title} subtitle={c.subtitle} />
      <ConnectionsPanel
        initialProviders={data.providers}
        encryptionAvailable={data.encryptionAvailable}
        loadError={loadError}
        messages={c}
        locale={locale}
      />
    </div>
  );
}
