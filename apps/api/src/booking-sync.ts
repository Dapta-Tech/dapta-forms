import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { getFormById, parseJsonColumn, resolveProviderToken, sql, type Db } from '@quill/db';
import {
  formConfigSchema,
  formDestinationSchema,
  type FormDestination,
  type HubspotDestination,
} from '@quill/types';
import type { ServerEnv } from '@quill/config/env';
import { OutboxSkipError } from './email-effects';
import type { BookingSyncPayload } from './booking-effects';
import { DB, ENV } from './tokens';

/** HubSpot public API base (overridable in tests via `hubspotApiBase`). */
export const HUBSPOT_API_BASE = 'https://api.hubapi.com';

/** The only origin booking URIs may be fetched from with the Calendly token. */
const CALENDLY_API_HOST = 'api.calendly.com';

/** Calendly GET /scheduled_events/:uuid | /invitees/:uuid response envelope. */
interface CalendlyResource {
  resource?: { start_time?: string; email?: string };
}

/**
 * Worker-side BOOKING → CRM delivery (the executor for `booking_sync` outbox
 * rows). Given the persisted callback facts it:
 *
 *   1. reloads the form's HubSpot destination config (fresh at delivery time),
 *   2. enriches via the Calendly API when the callback carried event/invitee
 *      URIs and `CALENDLY_API_TOKEN` is set (meeting start_time + invitee email),
 *   3. resolves the respondent email (Calendly invitee, else the submission
 *      answers for the session),
 *   4. builds the configured booking properties — `stageProperty` = stageValue,
 *      `hoursProperty` = meeting start epoch-ms, `dateProperty` = UTC-midnight
 *      epoch-ms of the meeting-start day (HubSpot `date` properties require
 *      midnight UTC) — and upserts the contact by email.
 *
 * Failure semantics match the outbox contract: a RETRYABLE transport failure
 * (network, HTTP 429/5xx) THROWS so the worker retries with backoff; a
 * permanent config gap (no destination, no bookingSync properties, no
 * resolvable email, a 4xx rejection) throws `OutboxSkipError` so the row is
 * recorded `skipped` once with the reason. Absent tokens degrade to log-only —
 * property KEYS are logged, never values (no PII in logs).
 */
@Injectable()
export class BookingSyncEffects {
  private readonly log = new Logger('BookingSync');
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl: typeof fetch = fetch;
  /** Overridable in tests to point the HubSpot client at a fake. */
  hubspotApiBase: string = HUBSPOT_API_BASE;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Optional() @Inject(ENV) private readonly env?: ServerEnv,
  ) {}

  /** The worker's executor for a `booking_sync` outbox row. */
  async deliver(_action: string, payloadJson: string): Promise<void> {
    const payload = JSON.parse(payloadJson) as BookingSyncPayload;

    const form = await getFormById(this.db, payload.accountId, payload.formId);
    if (!form) throw new OutboxSkipError('booking sync: form no longer exists');

    const destination = findHubspotDestination(form.config);
    if (!destination) {
      throw new OutboxSkipError('booking sync: no enabled HubSpot destination on the form');
    }
    const sync = destination.bookingSync;
    const hasStage = Boolean(sync?.stageProperty?.trim() && sync?.stageValue?.trim());
    const hasTimeProps = Boolean(sync?.dateProperty?.trim() || sync?.hoursProperty?.trim());
    if (!sync || (!hasStage && !hasTimeProps)) {
      throw new OutboxSkipError('booking sync: destination has no bookingSync properties configured');
    }

    // --- Calendly enrichment (event start + invitee email) -------------------
    let startMs = payload.startTime;
    let inviteeEmail: string | null = null;
    if (payload.provider === 'calendly' && (payload.eventUri || payload.inviteeUri)) {
      // Per-account Calendly token (connected → decrypted), else the env fallback.
      const token = await resolveProviderToken(
        this.db,
        payload.accountId,
        'calendly',
        this.env?.FORMS_ENCRYPTION_KEY,
        this.env?.CALENDLY_API_TOKEN,
      );
      if (!token) {
        // Graceful degradation: no token = no enrichment, never a hard failure.
        this.log.warn(
          'CALENDLY_API_TOKEN not set — booking sync proceeds without Calendly enrichment',
        );
      } else {
        const [event, invitee] = await Promise.all([
          payload.eventUri ? this.calendlyGet(payload.eventUri, token) : null,
          payload.inviteeUri ? this.calendlyGet(payload.inviteeUri, token) : null,
        ]);
        const fetchedStart = event?.resource?.start_time;
        if (fetchedStart) {
          const parsed = Date.parse(fetchedStart);
          if (Number.isFinite(parsed)) startMs = parsed;
        }
        const fetchedEmail = invitee?.resource?.email?.trim();
        if (fetchedEmail) inviteeEmail = fetchedEmail.toLowerCase();
      }
    }

    // --- Respondent email: invitee first, else the session's submission ------
    const email = inviteeEmail ?? (await this.emailFromSubmission(payload.formId, payload.sessionId));
    if (!email) {
      throw new OutboxSkipError(
        'booking sync: no respondent email resolvable (no Calendly invitee, none in the submission)',
      );
    }

    // --- Build the configured booking properties ------------------------------
    const properties: Record<string, string> = {};
    if (hasStage) properties[sync.stageProperty!.trim()] = sync.stageValue!.trim();
    if (startMs != null && Number.isFinite(startMs)) {
      if (sync.hoursProperty?.trim()) properties[sync.hoursProperty.trim()] = String(startMs);
      if (sync.dateProperty?.trim()) {
        properties[sync.dateProperty.trim()] = String(utcMidnightMs(startMs));
      }
    }
    if (Object.keys(properties).length === 0) {
      throw new OutboxSkipError(
        'booking sync: nothing to write (no meeting start time resolvable and no stage configured)',
      );
    }

    // --- Upsert the contact ----------------------------------------------------
    // Per-account HubSpot token (connected → decrypted), else the env fallback.
    const hubspotToken = await resolveProviderToken(
      this.db,
      payload.accountId,
      'hubspot',
      this.env?.FORMS_ENCRYPTION_KEY,
      this.env?.HUBSPOT_PRIVATE_APP_TOKEN,
    );
    if (!hubspotToken) {
      // Log-only degradation: property KEYS only — never values (no PII).
      this.log.log(
        `booking sync (log-only, HUBSPOT_PRIVATE_APP_TOKEN unset): would update contact ` +
          `properties [${Object.keys(properties).join(', ')}] for booking ${payload.bookingEventId}`,
      );
      throw new OutboxSkipError('HUBSPOT_PRIVATE_APP_TOKEN not set — booking sync logged property keys only');
    }
    await this.upsertContact(hubspotToken, email, properties);
    this.log.log(
      `booking sync delivered (booking ${payload.bookingEventId}): contact updated ` +
        `[${Object.keys(properties).join(', ')}]`,
    );
  }

  /**
   * GET a Calendly resource with the server token. Only ever called against
   * `api.calendly.com` — the URIs originate from the PUBLIC renderer, so an
   * off-host URI must never receive our bearer token (SSRF/token-exfil guard;
   * the pilot had no such check). Retryable failures (network, 429/5xx) THROW;
   * a 4xx or off-host URI degrades to `null` (enrichment is best-effort).
   */
  private async calendlyGet(url: string, token: string): Promise<CalendlyResource | null> {
    if (!isCalendlyApiUrl(url)) {
      this.log.warn('booking sync: ignoring non-Calendly booking URI (host not api.calendly.com)');
      return null;
    }
    const res = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`calendly fetch failed: HTTP ${res.status}`);
      }
      this.log.warn(`calendly fetch rejected (HTTP ${res.status}) — proceeding without enrichment`);
      return null;
    }
    return (await res.json()) as CalendlyResource;
  }

  /** Best-effort respondent email from the session's stored submission answers. */
  private async emailFromSubmission(formId: string, sessionId: string): Promise<string | null> {
    const row = await this.db.get<{ data: unknown }>(
      sql`SELECT data FROM submission WHERE form_id = ${formId} AND session_id = ${sessionId} LIMIT 1`,
    );
    if (!row) return null;
    const data = parseJsonColumn<Record<string, unknown>>(row.data, {});
    for (const [key, value] of Object.entries(data)) {
      if (typeof value !== 'string') continue;
      if (/@/.test(value) && (key.toLowerCase().includes('email') || /@[^@]+\.[^@]+$/.test(value))) {
        return value.trim().toLowerCase();
      }
    }
    return null;
  }

  /**
   * Minimal focused HubSpot client: upsert one contact keyed by email (the
   * same `batch/upsert` wire the pilot used). Deliberately NOT the destinations
   * package adapter — this flow writes booking properties only and must not
   * couple to the submission-sync surface. 429/5xx THROW (retryable); any other
   * non-2xx is a permanent rejection (bad property/portal config) → skip. The
   * error detail body is never logged (it can echo contact data).
   */
  private async upsertContact(
    token: string,
    email: string,
    properties: Record<string, string>,
  ): Promise<void> {
    const res = await this.fetchImpl(`${this.hubspotApiBase}/crm/v3/objects/contacts/batch/upsert`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: [{ idProperty: 'email', id: email, properties }] }),
    });
    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`hubspot booking upsert failed: HTTP ${res.status}`);
      }
      throw new OutboxSkipError(
        `hubspot booking upsert rejected (HTTP ${res.status}) — check the configured booking properties`,
      );
    }
  }
}

/** UTC-midnight epoch-ms of the calendar day containing `epochMs` (UTC). */
export function utcMidnightMs(epochMs: number): number {
  const d = new Date(epochMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** True only for https URLs on the Calendly API host (bearer-token guard). */
function isCalendlyApiUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname === CALENDLY_API_HOST;
  } catch {
    return false;
  }
}

/**
 * The form's first ENABLED HubSpot destination, tolerant of loosely typed
 * stored JSON (mirrors DestinationEffects.extractDestinations): a config that
 * fails full validation still yields any individually-valid destination.
 */
function findHubspotDestination(config: unknown): HubspotDestination | null {
  let destinations: FormDestination[] = [];
  const parsed = formConfigSchema.safeParse(config);
  if (parsed.success) {
    destinations = parsed.data.destinations ?? [];
  } else if (
    config &&
    typeof config === 'object' &&
    Array.isArray((config as { destinations?: unknown }).destinations)
  ) {
    for (const d of (config as { destinations: unknown[] }).destinations) {
      const one = formDestinationSchema.safeParse(d);
      if (one.success) destinations.push(one.data);
    }
  }
  const hit = destinations.find((d) => d.type === 'hubspot' && d.enabled !== false);
  return hit && hit.type === 'hubspot' ? hit : null;
}
