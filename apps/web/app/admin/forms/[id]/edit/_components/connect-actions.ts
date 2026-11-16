'use server';

import { unstable_rethrow } from 'next/navigation';
import {
  adminApi,
  ApiError,
  type HubSpotPropertiesResponse,
  type SalesforceFieldsResponse,
} from '@/lib/admin-api';
import { getMessages } from '@quill/shared';
import type { FormDestination } from '@quill/types';

/**
 * Server data the Connect tab's Integrations section needs (the same
 * composition the old /admin/forms/[id]/integrations RSC page did, exposed as
 * a server action so the client-side editor can fetch it on tab activation).
 *
 * `destinations` come from the form's LIVE config: destinations are managed
 * live by the integrations save path (PUT /v1/forms/:id/destinations) and are
 * never staged into the editor's autosaved draft (saveDraftConfig strips the
 * key server-side; publish carries the live set over the draft) — so the live
 * config is always the authoritative source, never the draft.
 */
export interface ConnectIntegrationsData {
  destinations: FormDestination[];
  hubspot: HubSpotPropertiesResponse;
  hubspotConnected: boolean;
  /**
   * Whether the scheduling provider is connected for the account. A form whose
   * address comes from a scheduler needs this to be true or the invitee can
   * never be read back — see `contactKeyReadiness`.
   */
  calendlyConnected: boolean;
  /**
   * Whether Google Sheets is connected for the account. The spreadsheet card
   * is gated on it: without a connection there is no token to list a
   * spreadsheet's tabs with, so the picker could only ever show an error.
   */
  googleSheetsConnected: boolean;
  /**
   * Whether this deployment can connect Google Sheets at all. False when its
   * operator has registered no OAuth client, and then the spreadsheet card is
   * left out rather than sending the author to a page with nothing to click.
   */
  googleSheetsAvailable: boolean;
  /**
   * Whether an existing spreadsheet can be chosen: Google's Picker needs a
   * browser key the operator supplies. False, the card only creates new ones.
   */
  googlePickerAvailable: boolean;
  /** The form's own name, which names the spreadsheet the card creates. */
  formName: string;
  /** Whether Salesforce is connected for the account. */
  salesforceConnected: boolean;
  /**
   * The connected org's fields. Read only when connected: an account without
   * Salesforce should not pay a round trip for a card that shows a link.
   */
  salesforceFields: SalesforceFieldsResponse;
}

export async function loadConnectIntegrationsAction(
  id: string,
  locale: string,
): Promise<{ ok: true; data: ConnectIntegrationsData } | { ok: false; message: string }> {
  const m = getMessages(locale).admin.integrations;

  let form: Awaited<ReturnType<typeof adminApi.getForm>>;
  try {
    form = await adminApi.getForm(id);
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) return { ok: false, message: e.message };
    throw e;
  }

  // The property picker degrades gracefully — a lookup failure must not break
  // the whole tab; the editor shows a disabled state and still lets you save.
  let hubspot: HubSpotPropertiesResponse;
  try {
    hubspot = await adminApi.hubspotProperties();
  } catch (e) {
    unstable_rethrow(e); // a 401 must bounce to /login, not fake "disabled"
    hubspot = { enabled: false, reason: m.loadError };
  }

  // Account-level connection gates the mapping UI (Typeform model). A lookup
  // failure degrades to "not connected" — the editor still shows the mapping
  // when the property picker resolved via the server env fallback.
  let hubspotConnected = false;
  let calendlyConnected = false;
  let googleSheetsConnected = false;
  // True until the API says otherwise: a failed lookup must not make the card
  // vanish from a deployment where it works.
  let googleSheetsAvailable = true;
  let googlePickerAvailable = false;
  let salesforceConnected = false;
  try {
    const integrations = await adminApi.listIntegrations();
    hubspotConnected = integrations.providers.some((p) => p.provider === 'hubspot' && p.connected);
    calendlyConnected = integrations.providers.some(
      (p) => p.provider === 'calendly' && p.connected,
    );
    googleSheetsConnected = integrations.providers.some(
      (p) => p.provider === 'google-sheets' && p.connected,
    );
    googleSheetsAvailable = !(integrations.unavailable ?? []).includes('google-sheets');
    googlePickerAvailable = integrations.googlePicker === true;
    salesforceConnected = integrations.providers.some(
      (p) => p.provider === 'salesforce' && p.connected,
    );
  } catch (e) {
    unstable_rethrow(e);
    hubspotConnected = false;
    calendlyConnected = false;
    googleSheetsConnected = false;
  }

  // Like the HubSpot picker: a failed lookup degrades the card, never the tab.
  let salesforceFields: SalesforceFieldsResponse = { enabled: false, reason: 'not_connected' };
  if (salesforceConnected) {
    try {
      salesforceFields = await adminApi.salesforceFields();
    } catch (e) {
      unstable_rethrow(e);
      salesforceFields = { enabled: false, reason: 'unavailable' };
    }
  }

  return {
    ok: true,
    data: {
      destinations: (form.config.destinations ?? []) as FormDestination[],
      hubspot,
      hubspotConnected,
      calendlyConnected,
      googleSheetsConnected,
      googleSheetsAvailable,
      googlePickerAvailable,
      formName: form.name,
      salesforceConnected,
      salesforceFields,
    },
  };
}

// `loadFailedDeliveriesAction` lived here and fed the flat failure block this
// branch removed from the Connect tab. Its replacement is
// `loadDeliveryHistoryAction` in ../../integrations/actions.ts, next to the
// panel that reads it.
