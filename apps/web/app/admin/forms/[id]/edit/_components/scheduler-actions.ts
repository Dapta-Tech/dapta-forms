'use server';

import { adminApi, ApiError, type CalendlyEventTypesResponse } from '@/lib/admin-api';

/**
 * The scheduler step's event-type picker data: the account's Calendly event
 * types (per-account token, resolved server-side). Degrades to a disabled state
 * on any failure so the panel can prompt the author to connect Calendly instead
 * of erroring — mirrors the HubSpot property picker's graceful fallback.
 */
export async function loadCalendlyEventTypesAction(): Promise<CalendlyEventTypesResponse> {
  try {
    return await adminApi.calendlyEventTypes();
  } catch (e) {
    const reason = e instanceof ApiError ? e.message : 'Could not reach Calendly.';
    return { enabled: false, reason };
  }
}
