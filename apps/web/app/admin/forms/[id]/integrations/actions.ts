'use server';

import { unstable_rethrow } from 'next/navigation';

import { revalidatePath } from 'next/cache';
import {
  adminApi,
  ApiError,
  type DeliveryKind,
  type FormDelivery,
  type GoogleSheetsCreateResponse,
  type GoogleSheetsHeaderRowResponse,
  type GoogleSheetsPickerResponse,
  type GoogleSheetsTabsResponse,
  type FormSheetHeaderRowResponse,
  type HubSpotPropertiesResponse,
  type SalesforceFieldsResponse,
  type SheetHeaderSync,
  type WebhookPingResult,
} from '@/lib/admin-api';
import { sheetBaselineHeaders, type FormDestination } from '@quill/types';

/**
 * Save the integrations (destinations) for a form. Uses the API's PARTIAL
 * `destinations` write (PUT /v1/forms/:id/destinations) which merges only that
 * key against the form's fresh config server-side in ONE request — a concurrent
 * editor save of steps/cover/scoring is never clobbered by this screen (the old
 * shape read the whole config here and wrote it back across two requests,
 * racing the editor).
 *
 * NOTE (optimistic locking): true write-write safety on the SAME key (e.g. two
 * integrations tabs) still needs config versioning / compare-and-set — a general
 * question for every config writer, tracked separately and out of scope here.
 */
export async function saveIntegrationsAction(
  id: string,
  destinations: FormDestination[],
): Promise<{
  ok: boolean;
  message?: string;
  formActivityError?: string;
  sheetHeaders?: SheetHeaderSync;
  /**
   * The row 1 the API has on record for the spreadsheet card after this save
   * (null when it has none). The card uses it to keep a column whose heading
   * was cleared on the letter it still holds in the sheet.
   */
  sheetWritten?: string[] | null;
}> {
  try {
    // The API builds the HubSpot mirror form as part of this write and reports
    // a refusal without failing the save — an author must be able to edit their
    // mappings while a portal is unreachable or has not granted the scopes.
    // The spreadsheet's header row is brought in line the same way, and its
    // outcome rides back for the card to show.
    const saved = await adminApi.updateFormDestinations(id, destinations);
    revalidatePath(`/admin/forms/${id}/integrations`);
    return {
      ok: true,
      ...(saved.formActivityError ? { formActivityError: saved.formActivityError } : {}),
      ...(saved.sheetHeaders ? { sheetHeaders: saved.sheetHeaders } : {}),
      sheetWritten: sheetBaselineHeaders(
        (saved.config?.destinations ?? []).find((d: { type?: string }) => d.type === 'google-sheets'),
      ),
    };
  } catch (e) {
    unstable_rethrow(e);
    // Only the API's own refusal is worth showing as it is. A transport-level
    // message ("fetch failed") means nothing to an author, so the caller falls
    // back to its catalog sentence for that.
    return { ok: false, message: e instanceof ApiError ? e.message : undefined };
  }
}

/**
 * Attach one card's destination to whatever the form stores NOW.
 *
 * For a card action that finishes after the Connect tab was left (a
 * spreadsheet created in Drive while the author moved on to Build). The
 * editor that started it is gone, and the snapshot it held is as old as the
 * moment it unmounted: writing that whole array could undo a mapping made
 * since. So this reads the fresh destinations and replaces only the first
 * entry of the card's own type (or adds it), like the Build tab's
 * per-question picker does, and the editor sends it through the form's save
 * queue so it is serial with every other write.
 */
export async function mergeIntegrationCardAction(
  id: string,
  card: FormDestination,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const form = await adminApi.getForm(id);
    const destinations = (form.config.destinations ?? []) as FormDestination[];
    const index = destinations.findIndex((d) => d.type === card.type);
    const next = index === -1 ? [...destinations, card] : destinations.map((d, i) => (i === index ? card : d));
    await adminApi.updateFormDestinations(id, next);
    revalidatePath(`/admin/forms/${id}/integrations`);
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, message: e instanceof ApiError ? e.message : undefined };
  }
}

/**
 * Send one sample delivery to this form's configured webhook.
 *
 * The API does the work — and the guarding: admin-only, scoped to the caller's
 * account, and routed through the real adapter so the SSRF check that protects
 * every live delivery protects this one too.
 */
export async function pingWebhookAction(id: string): Promise<WebhookPingResult> {
  try {
    return await adminApi.pingWebhook(id);
  } catch (e) {
    unstable_rethrow(e);
    return {
      ok: false,
      reason: 'unknown',
      message: e instanceof Error ? e.message : 'Could not reach the webhook.',
    };
  }
}

/** How many rows one integration's history shows. */
const HISTORY_LIMIT = 25;

/**
 * One integration's delivery history for this form — what landed and what did
 * not — newest first.
 *
 * `pending` is asked for alongside the rest: a row still working through its
 * backoff is the most useful thing to see right after wiring an endpoint up, and
 * leaving it out would show a submission that produced no delivery at all.
 *
 * A lookup failure yields an empty list, because this is a diagnostic panel and
 * it must never make the thing it diagnoses look broken — but `unstable_rethrow`
 * runs FIRST. Next signals `redirect()` and `notFound()` by throwing, and the
 * admin API client redirects to /login on a 401; swallowing that here would turn
 * an expired session into a permanently empty history instead of a sign-in.
 */
export async function loadDeliveryHistoryAction(
  id: string,
  kinds: DeliveryKind[],
): Promise<FormDelivery[]> {
  try {
    const res = await adminApi.formDeliveries(id, {
      kinds,
      statuses: ['done', 'pending', 'failed', 'skipped'],
      limit: HISTORY_LIMIT,
    });
    return res.items;
  } catch (e) {
    unstable_rethrow(e);
    return [];
  }
}

/**
 * The tabs of one spreadsheet, for the Google Sheets card's picker.
 *
 * The outcome rides in the payload rather than as a thrown error: the card
 * shows a different sentence for each reason (connect Google, check the link,
 * ask for access), and a rejected promise would flatten all of them into one.
 */
export async function googleSheetsTabsAction(
  spreadsheetId: string,
): Promise<{ ok: true; data: GoogleSheetsTabsResponse } | { ok: false; message?: string }> {
  try {
    return { ok: true, data: await adminApi.googleSheetsTabs(spreadsheetId) };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) return { ok: false, message: e.message };
    return { ok: false };
  }
}

/** Create a spreadsheet for this form in the connected Google account. */
export async function googleSheetsCreateAction(body: {
  title: string;
  sheetTitle: string;
  headers: string[];
}): Promise<{ ok: true; data: GoogleSheetsCreateResponse } | { ok: false; message?: string }> {
  try {
    return { ok: true, data: await adminApi.googleSheetsCreate(body) };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) return { ok: false, message: e.message };
    return { ok: false };
  }
}

/**
 * What Google's Picker needs to open in this browser.
 *
 * The answer carries a short-lived Google access token on purpose: the Picker
 * runs client-side and cannot be given one any other way. It is fetched at the
 * click that opens the Picker and held only for that one call, never in state.
 */
export async function googleSheetsPickerAction(): Promise<
  { ok: true; data: GoogleSheetsPickerResponse } | { ok: false; message?: string }
> {
  try {
    return { ok: true, data: await adminApi.googleSheetsPicker() };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) return { ok: false, message: e.message };
    return { ok: false };
  }
}

/**
 * Bring the form's spreadsheet header row in line with its saved columns.
 *
 * Form-scoped: the API reads the columns, the spreadsheet and what dForms last
 * wrote from the stored form, so nothing sent from here decides what may be
 * overwritten. A row 1 holding anything dForms did not write comes back as
 * `foreign` and is left alone.
 */
export async function syncSheetHeadersAction(
  formId: string,
  /**
   * `replace`: the author confirmed "replace row 1". `check`: the card is
   * opening, so only look (nothing written, nothing stored).
   */
  mode: boolean | 'check' = false,
): Promise<{ ok: true; data: FormSheetHeaderRowResponse } | { ok: false; message?: string }> {
  try {
    const opts = mode === 'check' ? { check: true } : { replace: mode === true };
    return { ok: true, data: await adminApi.syncFormSheetHeaders(formId, opts) };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) return { ok: false, message: e.message };
    return { ok: false };
  }
}

/**
 * HubSpot's contact properties, re-read after HubSpot was connected from the
 * form's own Connect tab, so the mapping can open without reloading the page.
 */
export async function hubspotPropertiesAction(): Promise<HubSpotPropertiesResponse> {
  try {
    return await adminApi.hubspotProperties();
  } catch (e) {
    unstable_rethrow(e);
    return { enabled: false, reason: e instanceof Error ? e.message : 'unavailable' };
  }
}

/** Write the header row of the chosen tab, once. Never overwrites a used row 1. */
export async function googleSheetsHeaderRowAction(body: {
  spreadsheetId: string;
  sheetTitle?: string;
  headers: string[];
}): Promise<{ ok: true; data: GoogleSheetsHeaderRowResponse } | { ok: false; message?: string }> {
  try {
    return { ok: true, data: await adminApi.googleSheetsHeaderRow(body) };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) return { ok: false, message: e.message };
    return { ok: false };
  }
}

/**
 * Re-read the connected Salesforce org's fields, skipping the five-minute
 * cache: what an author needs right after adding a custom field in Salesforce.
 */
export async function salesforceFieldsAction(
  refresh: boolean,
): Promise<{ ok: true; fields: SalesforceFieldsResponse } | { ok: false }> {
  try {
    return { ok: true, fields: await adminApi.salesforceFields(refresh) };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false };
  }
}
