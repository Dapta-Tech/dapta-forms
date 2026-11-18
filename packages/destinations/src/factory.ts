import type { DestinationType, SubmissionDestination } from './destination.port';
import { LogOnlyDestination } from './adapters/log-only';
import { WebhookDestination, type WebhookDestinationOptions } from './adapters/webhook';
import { HubspotDestination, type HubspotDestinationOptions } from './adapters/hubspot';
import {
  GoogleSheetsDestination,
  type GoogleSheetsDestinationOptions,
} from './adapters/google-sheets';
import { SalesforceDestination, type SalesforceDestinationOptions } from './adapters/salesforce';
import { GoHighLevelDestination } from './adapters/gohighlevel';
import { GOHIGHLEVEL_REASONS, writableSheetColumns, type GoHighLevelDeliveryOptions } from '@quill/types';

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
  googleSheets?: GoogleSheetsDestinationOptions;
  salesforce?: SalesforceDestinationOptions;
  /** The stored mappings plus the account's credentials, resolved by the API. */
  gohighlevel?: GoHighLevelDeliveryOptions;
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
    case 'google-sheets': {
      const sheets = spec.googleSheets;
      // Three ways to be unconfigured, each with its own sentence, because they
      // are three different things for the author to go and fix: nobody has
      // connected Google (or the grant died and could not be renewed), nobody
      // has chosen a spreadsheet, or nobody has said what the row holds. A row
      // of nothing is not a delivery, so the last one degrades too rather than
      // appending blank lines to somebody's sheet forever.
      if (!sheets?.accessToken) {
        return new LogOnlyDestination('google sheets destination has no usable access token');
      }
      if (!sheets.spreadsheetId) {
        return new LogOnlyDestination('google sheets destination missing a spreadsheet');
      }
      if (!writableSheetColumns(sheets.columns).length) {
        return new LogOnlyDestination('google sheets destination has no columns configured');
      }
      return new GoogleSheetsDestination(sheets, fetchImpl);
    }
    case 'salesforce': {
      const sf = spec.salesforce;
      // Not connected, or the org refused to mint a token (the app was revoked,
      // the secret rotated): a no-op the delivery history names, not a retry.
      if (!sf?.accessToken || !sf.instanceUrl) {
        return new LogOnlyDestination('salesforce destination has no usable connection (reconnect Salesforce)');
      }
      return new SalesforceDestination(sf, fetchImpl);
    }
    case 'gohighlevel': {
      const ghl = spec.gohighlevel;
      // Not connected, or the connection is missing half of itself: the named
      // no-op the delivery history shows as "reconnect HighLevel", not a retry.
      if (!ghl?.credentials?.token?.trim() || !ghl.credentials.locationId?.trim()) {
        return new LogOnlyDestination(GOHIGHLEVEL_REASONS.notConnected);
      }
      return new GoHighLevelDestination(ghl, fetchImpl);
    }
    default:
      return new LogOnlyDestination(`unknown destination type: ${String(spec.type)}`);
  }
}
