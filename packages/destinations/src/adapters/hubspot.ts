import { propertiesFor } from '@quill/types';
import type {
  DestinationContext,
  DestinationResult,
  SubmissionDestination,
} from '../destination.port';

/** HubSpot public API base (overridable in tests). */
export const HUBSPOT_API_BASE = 'https://api.hubapi.com';
/** HUBSPOT_DEFINED note→contact association type id (v3). */
const NOTE_TO_CONTACT_ASSOCIATION_TYPE_ID = 202;
/** Upsert retries: strip an invalid property the portal rejected, then retry. */
const MAX_UPSERT_ATTEMPTS = 15;

export interface HubspotDestinationOptions {
  /** HubSpot private-app token (server-side only; never sent to the browser). */
  token: string;
  /** stepKey -> contact property. One mapping's property SHOULD be `email`. */
  fieldMappings: Record<string, string | string[]>;
  /** utmKey (utm_source…) -> contact property. */
  utmMappings?: Record<string, string>;
  /** Contact property to write the server-computed score to (complete only). */
  scoreProperty?: string;
  /** Contact date property to write the submitted date to (UTC-midnight ms). */
  dateProperty?: string;
  /** Create a Note engagement on a completed submission (default true). */
  note?: boolean;
  /**
   * stepKey -> (raw answer value -> CRM picklist value). Applied when mapping
   * `fieldMappings`: a raw value with an entry is replaced by its mapped CRM
   * value; an unmapped value passes through unchanged (pilot's
   * `transformHubSpotValue` — e.g. use-case slug -> "AI Calls").
   */
  valueMaps?: Record<string, Record<string, string>>;
  /** Contact property to receive the resolved outcome label (complete only). */
  outcomeProperty?: string;
  /**
   * Fixed property values stamped on every COMPLETED submission (pilot's static
   * optin/goal properties). Lowest precedence: a static property never
   * overwrites a value already produced by field/UTM mappings or the
   * score/date/outcome properties.
   */
  staticProperties?: Record<string, string>;
  /**
   * When true and the respondent's email is corporate (not a free-mail
   * domain), fill the standard `company` (capitalized domain base) and
   * `website` (https://domain) contact properties — ONLY when not already set
   * by mappings/static properties (pilot's `enrichAnswersForSubmit`).
   */
  inferCompanyFromEmail?: boolean;
}

interface HubSpotUpsertResponse {
  results?: Array<{ id: string }>;
}
interface HubSpotValidationError {
  code?: string;
  context?: { propertyName?: string[] };
}
interface HubSpotErrorResponse {
  errors?: HubSpotValidationError[];
}

/**
 * HUBSPOT destination — upserts the respondent as a contact (keyed by email),
 * maps configured form fields + UTM values to contact properties, writes the
 * score and submitted-date to configurable properties, and (on a completed
 * submission) attaches a Note engagement summarizing the submission. Port of the
 * pilot's HubSpot sync (`hubspotUpsert`/`hubspotSync`/`note`) generalized behind
 * the destination interface — no property names are baked in. Pilot extras are
 * config-driven too: per-step value maps (answer -> picklist label), an
 * outcome-label property, static properties, and company/website inference
 * from a corporate email domain (see `buildProperties` for precedence).
 *
 * Reliability: a transport failure (network, non-2xx after invalid-property
 * stripping) THROWS so the durable outbox retries. A submission with no email to
 * key on is a permanent no-op (`delivered:false`, marked done — retrying can't
 * conjure an email). A Note failure is logged but never fails the delivery (the
 * contact upsert already succeeded — the durable part).
 */
export class HubspotDestination implements SubmissionDestination {
  readonly type = 'hubspot' as const;

  constructor(
    private readonly opts: HubspotDestinationOptions,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl: string = HUBSPOT_API_BASE,
    private readonly logger: Pick<Console, 'warn'> = console,
  ) {}

  /**
   * Build the contact properties exactly as sent to HubSpot (pure — exported
   * shape for tests). Empty/whitespace values are dropped; email is guaranteed
   * present in the returned object only when resolvable (caller checks).
   *
   * Precedence (highest first): field mappings (with value maps applied) →
   * UTM mappings → date/score/outcome properties → static properties (fill
   * holes only) → company/website inference (fill holes only).
   */
  buildProperties(ctx: DestinationContext): Record<string, string> {
    const props: Record<string, string> = {};

    // Field mappings: stepKey -> contact property, with per-step value maps
    // translating a raw answer to its CRM picklist value (unmapped raw values
    // pass through unchanged).
    for (const [stepKey, target] of Object.entries(this.opts.fieldMappings)) {
      const properties = propertiesFor(target);
      if (properties.length === 0) continue;
      const value = ctx.data[stepKey];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        const raw = String(value).trim();
        // The value map is per STEP, so every property this answer feeds gets
        // the same translated value — which is the whole point of fanning out.
        const translated = this.opts.valueMaps?.[stepKey]?.[raw] ?? raw;
        for (const property of properties) props[property] = translated;
      }
    }

    // UTM mappings: utmKey -> contact property.
    for (const [utmKey, property] of Object.entries(this.opts.utmMappings ?? {})) {
      if (!property?.trim()) continue;
      const value = ctx.utm[utmKey];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        props[property.trim()] = String(value).trim();
      }
    }

    // Submitted-date → configurable date property (HubSpot date = UTC-midnight ms).
    if (this.opts.dateProperty?.trim()) {
      props[this.opts.dateProperty.trim()] = toHubSpotDateMs(ctx.submittedAt);
    }

    // Score → configurable property (complete submissions only, mirroring the pilot).
    if (this.opts.scoreProperty?.trim() && ctx.phase === 'complete') {
      props[this.opts.scoreProperty.trim()] = String(ctx.score);
    }

    // Outcome label → configurable property (complete only; the label is the
    // server-resolved outcome bucket — absent when the form scores to none).
    if (this.opts.outcomeProperty?.trim() && ctx.phase === 'complete' && ctx.outcomeLabel) {
      props[this.opts.outcomeProperty.trim()] = ctx.outcomeLabel;
    }

    // Static properties (complete only) — lowest-precedence config: stamp fixed
    // values, but NEVER overwrite a property already produced above.
    if (ctx.phase === 'complete') {
      for (const [property, value] of Object.entries(this.opts.staticProperties ?? {})) {
        const name = property.trim();
        if (!name || name in props) continue;
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          props[name] = String(value).trim();
        }
      }
    }

    // Company/website inference from a corporate email domain — fills the
    // standard `company`/`website` properties only when nothing else set them.
    if (this.opts.inferCompanyFromEmail) {
      const inferred = inferCompanyProperties(this.resolveEmail(ctx));
      if (inferred) {
        if (!('company' in props)) props.company = inferred.company;
        if (!('website' in props)) props.website = inferred.website;
      }
    }

    return props;
  }

  /** Resolve the respondent email from the field mappings, then the raw data. */
  resolveEmail(ctx: DestinationContext): string | null {
    for (const [stepKey, target] of Object.entries(this.opts.fieldMappings)) {
      if (propertiesFor(target).includes('email') && ctx.data[stepKey]) {
        return String(ctx.data[stepKey]).trim();
      }
    }
    if (typeof ctx.data.email === 'string' && ctx.data.email.trim()) return ctx.data.email.trim();
    return null;
  }

  async deliver(ctx: DestinationContext): Promise<DestinationResult> {
    const email = this.resolveEmail(ctx);
    if (!email) {
      // No key to upsert on — a permanent no-op, not a retryable failure.
      return { delivered: false, driver: 'hubspot', detail: 'no email in submission' };
    }
    const properties = this.buildProperties(ctx);
    properties.email = email;

    const upsert = await this.upsertContact(properties);
    const contactId = upsert.contactId;

    let noteDetail = '';
    if (ctx.phase === 'complete' && this.opts.note !== false && contactId) {
      const noteOk = await this.createNote(contactId, ctx, properties);
      noteDetail = noteOk ? ' +note' : ' (note failed)';
    }

    const skipped = upsert.skippedProperties?.length
      ? ` skipped=[${upsert.skippedProperties.join(', ')}]`
      : '';
    return {
      delivered: true,
      driver: 'hubspot',
      detail: `contact=${contactId ?? '?'}${noteDetail}${skipped}`,
    };
  }

  /**
   * Upsert a contact by email. On a 400 that names non-existent/invalid
   * properties, strip them and retry (the portal may not have every mapped
   * property) — mirrors the pilot. Any other non-2xx THROWS so the outbox
   * retries.
   */
  private async upsertContact(
    properties: Record<string, string>,
  ): Promise<{ contactId?: string; skippedProperties?: string[] }> {
    const props = { ...properties };
    const skippedProperties: string[] = [];

    for (let attempt = 0; attempt < MAX_UPSERT_ATTEMPTS; attempt++) {
      const res = await this.fetchImpl(`${this.baseUrl}/crm/v3/objects/contacts/batch/upsert`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.opts.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          inputs: [{ idProperty: 'email', id: props.email, properties: props }],
        }),
      });

      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as HubSpotUpsertResponse;
        return {
          contactId: body.results?.[0]?.id,
          skippedProperties: skippedProperties.length ? skippedProperties : undefined,
        };
      }

      const errorText = await res.text().catch(() => '');
      if (res.status === 400) {
        const retryable = extractRetryablePropertyNames(errorText);
        const removed = retryable.filter((name) => name in props && name !== 'email');
        if (removed.length > 0) {
          for (const name of removed) {
            delete props[name];
            skippedProperties.push(name);
          }
          continue;
        }
      }
      // Non-recoverable transport/validation failure — retry via the outbox.
      throw new Error(`hubspot upsert failed: HTTP ${res.status} ${errorText.slice(0, 300)}`);
    }
    throw new Error('hubspot upsert failed: too many invalid-property retries');
  }

  /** Attach a Note engagement (v3, falling back to legacy v1). Never throws. */
  private async createNote(
    contactId: string,
    ctx: DestinationContext,
    properties: Record<string, string>,
  ): Promise<boolean> {
    const body = buildSubmissionNoteBody(properties, {
      formName: ctx.formName,
      score: ctx.score,
      outcomeLabel: ctx.outcomeLabel,
      submittedAt: ctx.submittedAt,
    });
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/crm/v3/objects/notes`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.opts.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          properties: { hs_note_body: body, hs_timestamp: String(ctx.submittedAt) },
          associations: [
            {
              to: { id: contactId },
              types: [
                {
                  associationCategory: 'HUBSPOT_DEFINED',
                  associationTypeId: NOTE_TO_CONTACT_ASSOCIATION_TYPE_ID,
                },
              ],
            },
          ],
        }),
      });
      if (res.ok) return true;
      this.logger.warn(`[destination:hubspot] note v3 failed: HTTP ${res.status}`);
    } catch (err) {
      this.logger.warn(`[destination:hubspot] note v3 error: ${String(err)}`);
    }
    // Legacy v1 fallback.
    const contactIdNum = Number.parseInt(contactId, 10);
    if (Number.isNaN(contactIdNum)) return false;
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/engagements/v1/engagements`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.opts.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          engagement: { active: true, type: 'NOTE', timestamp: ctx.submittedAt },
          associations: { contactIds: [contactIdNum], companyIds: [], dealIds: [], ownerIds: [] },
          metadata: { body },
        }),
      });
      if (res.ok) return true;
      this.logger.warn(`[destination:hubspot] note v1 failed: HTTP ${res.status}`);
      return false;
    } catch (err) {
      this.logger.warn(`[destination:hubspot] note v1 error: ${String(err)}`);
      return false;
    }
  }
}

/** Names of properties HubSpot rejected as non-existent/invalid (retry-strippable). */
export function extractRetryablePropertyNames(errorText: string): string[] {
  try {
    const parsed = JSON.parse(errorText) as HubSpotErrorResponse;
    const names = new Set<string>();
    const retryableCodes = new Set(['PROPERTY_DOESNT_EXIST', 'INVALID_OPTION', 'INVALID_DATE']);
    for (const err of parsed.errors ?? []) {
      if (err.code && retryableCodes.has(err.code)) {
        for (const name of err.context?.propertyName ?? []) names.add(name);
      }
    }
    return [...names];
  } catch {
    return [];
  }
}

/**
 * Personal/free email domains skipped by company inference. Mirrors the
 * engine's `isPersonalEmail` (`PERSONAL_EMAIL_DOMAINS` + `FREE_EMAIL_BASES` in
 * `packages/engine/src/form-logic.ts`) — duplicated locally because this
 * package intentionally depends only on @quill/types, never on the engine.
 * Keep the two lists in sync.
 */
const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'hotmail.com',
  'outlook.com',
  'yahoo.com',
  'icloud.com',
  'live.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
]);
/** Domain "base" tokens (before the first dot) also treated as free-mail. */
const FREE_EMAIL_BASES = new Set([
  'gmail',
  'hotmail',
  'outlook',
  'yahoo',
  'icloud',
  'live',
  'aol',
  'msn',
  'proton',
  'protonmail',
]);

/**
 * Derive `company` (capitalized domain base) + `website` (https://domain) from
 * a CORPORATE email. Returns null for a missing/malformed address or a
 * personal/free-mail domain (inference from gmail.com would be noise). Port of
 * the pilot's `enrichAnswersForSubmit` domain inference. Exported for testing.
 */
export function inferCompanyProperties(
  email: string | null,
): { company: string; website: string } | null {
  if (!email) return null;
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  if (!domain || !domain.includes('.')) return null;
  const base = domain.split('.')[0] ?? '';
  if (!base) return null;
  if (PERSONAL_EMAIL_DOMAINS.has(domain) || FREE_EMAIL_BASES.has(base)) return null;
  return {
    company: base.charAt(0).toUpperCase() + base.slice(1),
    website: `https://${domain}`,
  };
}

/**
 * A HubSpot date property expects UTC-midnight epoch-ms. Truncate the instant to
 * its UTC calendar day so the date isn't shifted by the time-of-day. Exported for
 * testing.
 */
export function toHubSpotDateMs(epochMs: number): string {
  const d = new Date(epochMs);
  return String(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The Note engagement body: form name, submitted date, score/outcome, fields. */
export function buildSubmissionNoteBody(
  properties: Record<string, string>,
  opts: { formName: string; score: number; outcomeLabel: string | null; submittedAt: number },
): string {
  const submittedAt = new Date(opts.submittedAt).toISOString();
  const qualification = opts.outcomeLabel ?? String(opts.score);
  const fieldLines = Object.entries(properties)
    .filter(([key]) => key !== 'email')
    .map(
      ([key, value]) =>
        `<p style="margin:0 0 6px 0;">• <strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</p>`,
    )
    .join('');
  return [
    `<p style="margin:0 0 8px 0;"><strong>Form submission — ${escapeHtml(opts.formName)}</strong></p>`,
    `<p style="margin:0 0 6px 0;"><strong>Submitted:</strong> ${escapeHtml(submittedAt)}</p>`,
    `<p style="margin:0 0 6px 0;"><strong>Score:</strong> ${escapeHtml(String(opts.score))}</p>`,
    `<p style="margin:0 0 6px 0;"><strong>Outcome:</strong> ${escapeHtml(qualification)}</p>`,
    `<p style="margin:8px 0 8px 0;"><strong>Submitted data:</strong></p>`,
    fieldLines || `<p style="margin:0;">—</p>`,
  ].join('\n');
}
