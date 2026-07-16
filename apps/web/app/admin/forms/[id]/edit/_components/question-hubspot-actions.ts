'use server';

import { adminApi, ApiError } from '@/lib/admin-api';
import type { FormDestination } from '@quill/types';

/**
 * Partial mapping write for the Build tab's per-question "Map to" picker:
 * read the LATEST live destinations, change ONLY `fieldMappings[stepKey]` on
 * the hubspot destination, and save through the same partial endpoint the
 * integrations editor uses (PUT /v1/forms/:id/destinations — replaces just the
 * config's `destinations` key server-side, so the editor's draft autosave is
 * never clobbered).
 *
 * The read-modify-write happens server-side in one action against fresh data,
 * so a mapping picked in the settings panel never reverts edits made moments
 * earlier in the Connect tab (same single-user concurrency stance as the
 * integrations editor). Webhook destinations round-trip untouched — their
 * masked secret sentinel is merged back to the stored value by the API.
 */
export type SaveQuestionMappingResult =
  | { ok: true; destinations: FormDestination[] }
  /** `no_destination`: the hubspot destination was disabled/removed since the
   *  panel loaded — the caller should resync and fall back to the CTA state. */
  | { ok: false; code: 'no_destination' | 'error'; message?: string };

export async function saveQuestionMappingAction(
  id: string,
  stepKey: string,
  /** The HubSpot property name; null/empty unmaps the question. */
  property: string | null,
): Promise<SaveQuestionMappingResult> {
  try {
    const form = await adminApi.getForm(id);
    const destinations = (form.config.destinations ?? []) as FormDestination[];
    const current = destinations.find(
      (d): d is Extract<FormDestination, { type: 'hubspot' }> => d.type === 'hubspot',
    );
    if (!current?.enabled) return { ok: false, code: 'no_destination' };

    const fieldMappings = { ...(current.fieldMappings ?? {}) };
    const next = property?.trim();
    if (next) fieldMappings[stepKey] = next;
    else delete fieldMappings[stepKey];

    const updated = await adminApi.updateFormDestinations(
      id,
      destinations.map((d) => (d === current ? { ...current, fieldMappings } : d)),
    );
    return { ok: true, destinations: (updated.config.destinations ?? []) as FormDestination[] };
  } catch (e) {
    return { ok: false, code: 'error', message: e instanceof ApiError ? e.message : undefined };
  }
}
