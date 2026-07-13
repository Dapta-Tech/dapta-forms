import type { DestinationType, SubmissionDestination } from './destination.port';
import { LogOnlyDestination } from './adapters/log-only';
import { WebhookDestination, type WebhookDestinationOptions } from './adapters/webhook';
import { HubspotDestination, type HubspotDestinationOptions } from './adapters/hubspot';

/**
 * A fully-resolved destination spec: the form-config settings for the chosen
 * `type`, with any server-side secret (the HubSpot token) already injected by the
 * API layer. The factory owns ONLY selection + graceful degradation — it never
 * reads env or the DB.
 */
export interface DestinationSpec {
  type: DestinationType;
  webhook?: WebhookDestinationOptions;
  hubspot?: HubspotDestinationOptions;
}

/**
 * Select the SubmissionDestination for a spec. Falls back to log-only whenever a
 * chosen destination is missing its required settings (no webhook URL, no HubSpot
 * token) — so a misconfigured destination degrades to a harmless log instead of
 * crashing submission handling (mirrors createEmailProvider). `fetchImpl` is
 * threaded through for tests.
 */
export function createDestination(
  spec: DestinationSpec,
  fetchImpl: typeof fetch = fetch,
): SubmissionDestination {
  switch (spec.type) {
    case 'webhook':
      if (spec.webhook?.url) return new WebhookDestination(spec.webhook, fetchImpl);
      return new LogOnlyDestination('webhook destination missing URL');
    case 'hubspot':
      if (spec.hubspot?.token) return new HubspotDestination(spec.hubspot, fetchImpl);
      return new LogOnlyDestination('hubspot destination missing token (HUBSPOT_PRIVATE_APP_TOKEN)');
    default:
      return new LogOnlyDestination(`unknown destination type: ${String(spec.type)}`);
  }
}
