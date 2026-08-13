import {
  HUBSPOT_API_BASE,
  buildMirrorFormPayload,
  mirrorFormName,
  mirrorFormProperties,
} from '@quill/destinations';
import type { FormDestination } from '@quill/types';

/**
 * Creating and updating the HubSpot MIRROR FORM — the object that makes a
 * submission show up as a "Form submission" activity on the contact.
 *
 * This lives in the API and not in the adapter for one reason: the guid has to
 * be written down. `@quill/destinations` has no database (invariant 7), so an
 * adapter that created the form would have nowhere to record it and would make
 * a new one on every delivery. Creation is also a SETUP action — it belongs to
 * the moment the author saves the integration, where a failure is something
 * they can see and act on, rather than buried in an outbox retry hours later.
 *
 * Nothing here ever fails a save. A portal that has not granted the scopes, or
 * is briefly unreachable, must not stop an author from editing their field
 * mappings; the reason is returned so the screen can say what happened.
 */

/** A HubSpot destination's mirror-form settings, as stored. */
interface MirrorSettings {
  note?: boolean;
  formGuid?: string | null;
  formActivity?: boolean;
  formSignature?: string;
}

export interface MirrorSyncResult {
  /** The settings to store — unchanged when there was nothing to do. */
  settings: MirrorSettings;
  /** Why the mirror could not be built. Absent = nothing went wrong. */
  error?: string;
  /** What happened, for logs and tests. */
  action: 'noop' | 'unchanged' | 'created' | 'updated' | 'failed';
}

/**
 * What the mirror is built from. Compared against the stored signature so an
 * autosave that changed a redirect URL does not rebuild a form in the portal.
 * The NAME is part of it because the name is what identifies the form on the
 * activity — a renamed Dapta form whose mirror still carries the old title is
 * exactly the confusion this feature exists to remove.
 */
export function mirrorSignature(formName: string, properties: string[]): string {
  return JSON.stringify([mirrorFormName(formName), [...properties].sort()]);
}

/** HubSpot's error body, which puts the useful part in `message`. */
function reasonFrom(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: string; category?: string };
    if (parsed.message) return parsed.message;
    if (parsed.category) return `${parsed.category} (HTTP ${status})`;
  } catch {
    /* not JSON — fall through to the status */
  }
  return `HubSpot rejected the request (HTTP ${status}).`;
}

export interface MirrorSyncDeps {
  fetchImpl: typeof fetch;
  token: string | null;
  /** Overridable for tests; defaults to the real CRM host. */
  baseUrl?: string;
  /** Passed in so the payload stays a pure function of its arguments. */
  now?: () => Date;
}

/**
 * Bring this destination's mirror form in line with what the form now writes.
 *
 * Returns the settings to persist. The caller merges them into the destination
 * it is about to store, so the guid is written in the SAME request that created
 * it — there is no window where a form exists in the portal that nothing points
 * at.
 */
export async function syncMirrorForm(
  destination: FormDestination,
  formName: string,
  deps: MirrorSyncDeps,
): Promise<MirrorSyncResult> {
  if (destination.type !== 'hubspot') return { settings: {}, action: 'noop' };
  const settings: MirrorSettings = { ...(destination.settings ?? {}) };

  // Off, or never turned on: leave every stored value alone. `formGuid` in
  // particular survives, so re-enabling reuses the form rather than orphaning
  // the activities already attached to it.
  if (settings.formActivity !== true) return { settings, action: 'noop' };

  const properties = mirrorFormProperties({
    token: '',
    fieldMappings: destination.fieldMappings ?? {},
    utmMappings: destination.utmMappings ?? {},
    scoreProperty: destination.scoreProperty ?? undefined,
    dateProperty: destination.dateProperty ?? undefined,
    outcomeProperty: destination.outcomeProperty ?? undefined,
    staticProperties: destination.staticProperties,
  });
  const signature = mirrorSignature(formName, properties);

  // Already in step. This is the common path — the Connect tab autosaves, and
  // most saves change something the mirror does not care about.
  if (settings.formGuid && settings.formSignature === signature) {
    return { settings, action: 'unchanged' };
  }

  if (!deps.token) {
    return {
      settings,
      action: 'failed',
      error: 'No HubSpot token — connect HubSpot for this account first.',
    };
  }

  const base = deps.baseUrl ?? HUBSPOT_API_BASE;
  const createdAt = (deps.now?.() ?? new Date()).toISOString();
  const payload = buildMirrorFormPayload(formName, properties, createdAt);
  const existing = settings.formGuid;
  const url = existing
    ? `${base}/marketing/v3/forms/${encodeURIComponent(existing)}`
    : `${base}/marketing/v3/forms`;

  let res: Response;
  try {
    res = await deps.fetchImpl(url, {
      method: existing ? 'PATCH' : 'POST',
      headers: {
        authorization: `Bearer ${deps.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { settings, action: 'failed', error: `Could not reach HubSpot: ${String(err)}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // A mirror the portal no longer has is not an error to report back — the
    // author did not delete it from here, and refusing to make a new one would
    // leave the feature permanently broken for them. Drop the guid so the next
    // save creates one.
    if (existing && res.status === 404) {
      return {
        settings: { ...settings, formGuid: null, formSignature: undefined },
        action: 'failed',
        error: 'The HubSpot form for this Dapta form no longer exists — it will be recreated.',
      };
    }
    return { settings, action: 'failed', error: reasonFrom(res.status, body) };
  }

  const body = (await res.json().catch(() => ({}))) as { id?: string };
  const guid = body.id ?? existing;
  if (!guid) {
    return { settings, action: 'failed', error: 'HubSpot accepted the form but returned no id.' };
  }
  return {
    settings: { ...settings, formGuid: guid, formSignature: signature },
    action: existing ? 'updated' : 'created',
  };
}
