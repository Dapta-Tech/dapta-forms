import { unstable_rethrow } from 'next/navigation';
import { getMessages } from '@quill/shared';
import { adminApi, type AccountWebhook, type IntegrationsResponse } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { PageHeader } from '@/components/ui/page-header';
import { ConnectionsPanel } from './connections-panel';
import { WebhooksSection } from './webhooks-section';

export const dynamic = 'force-dynamic';

/**
 * Account-level Connections (Typeform's "General" tab): connect HubSpot and
 * Calendly once per account, then map fields per form. Reworked from the old
 * form-picker — per-form CRM/webhook mapping is reached from each form's own
 * integrations tab (the forms list → row menu → Integrations).
 *
 * Below the grid sits the WEBHOOK INVENTORY, which is a different kind of thing
 * and says so by being a separate section: a webhook is configured per form, so
 * it can only be listed here, never connected here. It belongs on this route
 * regardless — the dashboard's own shortcut to it has always been labelled
 * "Integrations & webhooks", a promise the page did not keep until now.
 */
export default async function ConnectionsPage() {
  const locale = await getLocale();
  const c = getMessages(locale).admin.connections;
  const timeZone = (await adminApi.me()).timezone ?? 'UTC';

  let data: IntegrationsResponse = { encryptionAvailable: false, providers: [] };
  let loadError = false;
  try {
    data = await adminApi.listIntegrations();
  } catch (e) {
    unstable_rethrow(e); // let a 401→redirect (or notFound) escape the catch
    loadError = true;
  }

  // Fetched and failed SEPARATELY from the connections above: the two answer
  // different questions from different tables, and a webhook query that errors
  // must not blank the connections grid (nor the other way round).
  let webhooks: AccountWebhook[] = [];
  let webhooksLoadError = false;
  try {
    webhooks = (await adminApi.listAccountWebhooks()).items;
  } catch (e) {
    unstable_rethrow(e);
    webhooksLoadError = true;
  }

  return (
    <div className="mx-auto max-w-[1520px] px-6 py-10 sm:px-8">
      <PageHeader title={c.title} subtitle={c.subtitle} />
      <ConnectionsPanel
        initialProviders={data.providers}
        encryptionAvailable={data.encryptionAvailable}
        serverProvided={data.serverProvided ?? []}
        loadError={loadError}
        messages={c}
        locale={locale}
      />
      <WebhooksSection
        items={webhooks}
        timeZone={timeZone}
        loadError={webhooksLoadError}
        m={c.webhooks}
        locale={locale}
      />
    </div>
  );
}
