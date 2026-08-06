'use server';

import { adminApi, ApiError } from '@/lib/admin-api';
import { propertiesFor, type FormDestination } from '@quill/types';

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

/**
 * Move a HubSpot field mapping from one step key to another after the builder
 * renames a question's field key (V5-A10).
 *
 * Mappings are keyed by step key and live in `destinations`, which the form
 * config's own autosave never writes — so without this the rename would leave
 * the mapping pointing at a key no step has any more, and the question would
 * quietly stop syncing to the CRM. Same read-modify-write shape (and the same
 * single-user concurrency stance) as `saveQuestionMappingAction`.
 *
 * `no_destination` when there is no enabled HubSpot destination, and a plain
 * `ok` when the old key simply had no mapping — both are non-events for the
 * caller, whose config rename has already succeeded either way.
 */
export async function renameQuestionMappingAction(
  id: string,
  oldKey: string,
  newKey: string,
): Promise<SaveQuestionMappingResult> {
  if (!oldKey || !newKey || oldKey === newKey) return { ok: false, code: 'no_destination' };
  try {
    const form = await adminApi.getForm(id);
    const destinations = (form.config.destinations ?? []) as FormDestination[];
    const current = destinations.find(
      (d): d is Extract<FormDestination, { type: 'hubspot' }> => d.type === 'hubspot',
    );
    if (!current?.enabled) return { ok: false, code: 'no_destination' };

    const fieldMappings = { ...(current.fieldMappings ?? {}) };
    const valueMaps = { ...(current.valueMaps ?? {}) };
    const hadField = fieldMappings[oldKey] != null;
    const hadValues = valueMaps[oldKey] != null;
    if (!hadField && !hadValues) return { ok: true, destinations };

    if (hadField) {
      fieldMappings[newKey] = fieldMappings[oldKey]!;
      delete fieldMappings[oldKey];
    }
    if (hadValues) {
      valueMaps[newKey] = valueMaps[oldKey]!;
      delete valueMaps[oldKey];
    }

    const updated = await adminApi.updateFormDestinations(
      id,
      destinations.map((d) =>
        d === current
          ? { ...current, fieldMappings, ...(hadValues ? { valueMaps } : {}) }
          : d,
      ),
    );
    return { ok: true, destinations: (updated.config.destinations ?? []) as FormDestination[] };
  } catch (e) {
    return { ok: false, code: 'error', message: e instanceof ApiError ? e.message : undefined };
  }
}

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
    // The panel edits ONE property — the first. A mapping that fans out to
    // several is authored in Connect, and a pick here must not silently drop the
    // others, so the tail rides through either way. Mirrors the optimistic
    // `withMapping` on the client, which already preserved it: without this the
    // server write put the two out of step and the extra properties vanished on
    // the next load.
    const rest = propertiesFor(fieldMappings[stepKey]).slice(1);
    const first = property?.trim();
    const next = first ? [first, ...rest] : rest;
    if (next.length > 1) fieldMappings[stepKey] = next;
    else if (next.length === 1) fieldMappings[stepKey] = next[0]!;
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
