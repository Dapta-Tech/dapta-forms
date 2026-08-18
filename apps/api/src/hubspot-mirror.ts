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

/**
 * The property sets to try, best first.
 *
 * HubSpot refuses some properties as form fields and will not say which. A
 * portal's `lifecyclestage` is the one this was found on: it exists, it is not
 * calculated, and its own metadata says `formField: true` — and a form
 * declaring it is still rejected with `400 internal error`, naming nothing.
 * Nothing in the property schema predicts it, so the offender cannot be
 * identified before the call or from the failure.
 *
 * Rather than maintain a list of HubSpot's special cases, the mirror degrades in
 * order of what the activity is FOR, and gently: the fixed stamps go first
 * because that is where a portal's system properties tend to be configured, then
 * everything but the answers, and finally the email. A single bad property
 * should not cost three good ones.
 *
 * The contact receives every property either way — the upsert is a separate
 * call that already strips what the portal rejects. What degrades here is only
 * what the ACTIVITY lists.
 *
 * Bounded, so a portal that refuses everything costs a handful of calls on a
 * save rather than a search.
 */
function propertyTiers(
  answers: string[],
  withoutStatic: string[],
  everything: string[],
): string[][] {
  const tiers: string[][] = [];
  for (const tier of [everything, withoutStatic, answers, ['email']]) {
    // Each step must actually be smaller, or it is a wasted call.
    if (!tiers.some((t) => t.length === tier.length)) tiers.push(tier);
  }
  return tiers;
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
  /**
   * The contact properties that actually exist in the portal.
   *
   * A form field naming a property the portal does not have makes the CREATE
   * fail — with `400 internal error`, which names nothing and is impossible to
   * act on. One stale mapping among many therefore costs the whole activity,
   * and mappings do go stale: `extractRetryablePropertyNames` exists precisely
   * because the contact upsert meets the same thing routinely.
   *
   * Filtering is not a compromise, it is the correct behaviour. The upsert
   * already strips these before writing, so a property the portal lacks never
   * reaches the contact — declaring it on the mirror would promise the activity
   * a field the submission cannot set.
   *
   * `null` = unknown (the lookup failed); nothing is filtered, and a create
   * that then fails is reported like any other.
   */
  knownProperties?: Set<string> | null;
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

  const mapped = mirrorFormProperties({
    token: '',
    fieldMappings: destination.fieldMappings ?? {},
    utmMappings: destination.utmMappings ?? {},
    scoreProperty: destination.scoreProperty ?? undefined,
    dateProperty: destination.dateProperty ?? undefined,
    outcomeProperty: destination.outcomeProperty ?? undefined,
    staticProperties: destination.staticProperties,
  });
  // Drop what the portal does not have. `email` always stays: it is the form's
  // key, every portal has it, and a mirror without it is not a contact form.
  // The answers alone — the fallback tier, and the part of the activity that is
  // actually the point.
  const answersMapped = mirrorFormProperties({
    token: '',
    fieldMappings: destination.fieldMappings ?? {},
  });
  // Everything but the fixed stamps — where a portal's system properties
  // (`lifecyclestage` and friends) are typically configured.
  const withoutStaticMapped = mirrorFormProperties({
    token: '',
    fieldMappings: destination.fieldMappings ?? {},
    utmMappings: destination.utmMappings ?? {},
    scoreProperty: destination.scoreProperty ?? undefined,
    dateProperty: destination.dateProperty ?? undefined,
    outcomeProperty: destination.outcomeProperty ?? undefined,
  });
  const known = deps.knownProperties;
  const keep = (list: string[]) =>
    known ? list.filter((p) => p === 'email' || known.has(p)) : list;
  const properties = keep(mapped);
  const answerProperties = keep(answersMapped);
  const withoutStaticProperties = keep(withoutStaticMapped);
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
      error: 'No HubSpot token. Connect HubSpot for this account first.',
    };
  }

  const base = deps.baseUrl ?? HUBSPOT_API_BASE;
  const createdAt = (deps.now?.() ?? new Date()).toISOString();
  const existing = settings.formGuid;
  const url = existing
    ? `${base}/marketing/v3/forms/${encodeURIComponent(existing)}`
    : `${base}/marketing/v3/forms`;

  // Best set first, degrading to the answers alone and then to the email. See
  // `propertyTiers`: HubSpot refuses some properties as form fields without
  // saying which, so the offender cannot be identified — only designed around.
  const tiers = propertyTiers(answerProperties, withoutStaticProperties, properties);
  let res: Response | null = null;
  let sent: string[] = properties;
  let lastBody = '';
  for (const tier of tiers) {
    sent = tier;
    try {
      res = await deps.fetchImpl(url, {
        method: existing ? 'PATCH' : 'POST',
        headers: {
          authorization: `Bearer ${deps.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(buildMirrorFormPayload(formName, tier, createdAt)),
      });
    } catch (err) {
      return { settings, action: 'failed', error: `Could not reach HubSpot: ${String(err)}` };
    }
    if (res.ok) break;
    lastBody = await res.text().catch(() => '');
    // A mirror the portal no longer has is not an error to report back — the
    // author did not delete it from here, and refusing to make a new one would
    // leave the feature permanently broken for them. Drop the guid so the next
    // save creates one. Never worth retrying with fewer fields.
    if (existing && res.status === 404) {
      return {
        settings: { ...settings, formGuid: null, formSignature: undefined },
        action: 'failed',
        error: 'The HubSpot form for this Dapta form no longer exists. It will be recreated.',
      };
    }
    // Only a rejected PAYLOAD is worth retrying smaller. A 401/403 is about the
    // token, and a 5xx is about HubSpot; neither gets better with fewer fields.
    if (res.status !== 400) break;
  }

  if (!res || !res.ok) {
    return { settings, action: 'failed', error: reasonFrom(res?.status ?? 0, lastBody) };
  }

  const body = (await res.json().catch(() => ({}))) as { id?: string };
  const guid = body.id ?? existing;
  if (!guid) {
    return { settings, action: 'failed', error: 'HubSpot accepted the form but returned no id.' };
  }
  // The signature records what was ACCEPTED, not what was asked for. Storing the
  // full set after a degraded create would make the next save think it was in
  // step and never try the fuller mirror again.
  return {
    settings: { ...settings, formGuid: guid, formSignature: mirrorSignature(formName, sent) },
    action: existing ? 'updated' : 'created',
  };
}
