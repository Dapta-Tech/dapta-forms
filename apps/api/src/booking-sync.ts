import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { getFormById, parseJsonColumn, resolveProviderToken, sql, type Db } from '@quill/db';
import {
  formConfigSchema,
  formDestinationSchema,
  type FormDestination,
  type HubspotDestination,
} from '@quill/types';
import { resolveOutcome, type FormConfig } from '@quill/engine';
import { createDestination } from '@quill/destinations';
import type { ServerEnv } from '@quill/config/env';
import { OutboxSkipError } from './email-effects';
import { extractUtm } from './destination-effects';
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
    // No early skip on absent bookingSync properties: even without them, a
    // booking may still carry the answers sync below. The "nothing to write"
    // decision is made at the end, once both halves are known.
    const sync = destination.bookingSync;
    const hasStage = Boolean(sync?.stageProperty?.trim() && sync?.stageValue?.trim());

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

    // --- The session's submission (one read serves three consumers below) ----
    const submission = await this.loadSubmission(payload.formId, payload.sessionId);

    // --- Respondent email: invitee first, else the session's submission ------
    const submissionEmail = submission ? looseEmailFromData(submission.data) : null;
    const email = inviteeEmail ?? submissionEmail;
    if (!email) {
      throw new OutboxSkipError(
        'booking sync: no respondent email resolvable (no Calendly invitee, none in the submission)',
      );
    }

    // --- Build the configured booking properties ------------------------------
    const properties: Record<string, string> = {};
    if (hasStage && sync) properties[sync.stageProperty!.trim()] = sync.stageValue!.trim();
    if (sync && startMs != null && Number.isFinite(startMs)) {
      if (sync.hoursProperty?.trim()) properties[sync.hoursProperty.trim()] = String(startMs);
      if (sync.dateProperty?.trim()) {
        properties[sync.dateProperty.trim()] = String(utcMidnightMs(startMs));
      }
    }

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

    // --- Booking properties FIRST — write order is the retry-safety here -------
    // The answers sync below ends in a Note engagement, which HubSpot's API
    // offers no idempotent create for. Everything BEFORE the Note must therefore
    // be a retry-safe upsert, and NOTHING may run after it: with the booking
    // upsert first and the Note last, no retryable failure can fire once a Note
    // exists, so the outbox retrying this row can never duplicate one.
    const wroteBooking = Object.keys(properties).length > 0;
    if (wroteBooking) await this.upsertContact(hubspotToken, email, properties);

    // --- Full answers sync, keyed on the invitee (V7) --------------------------
    // A form whose scheduler collects the email (no email QUESTION of its own)
    // reaches submit time with nothing for the HubSpot destination to key on, so
    // that delivery resolved as a permanent no-op and the quiz answers never
    // synced. The Calendly invitee address closes the gap: run the SAME mapped
    // delivery the submit path would have run, with the invitee email injected.
    // Gated on the ADAPTER's own email resolution (a mapping to `email`, or an
    // `email` answer): when THAT delivery already ran at submit time — Note
    // included — this path must never double-write. The looser email heuristic
    // above stays only as the booking-properties key fallback it always was.
    const adapterEmail = submission ? adapterResolvableEmail(destination, submission.data) : null;
    const syncedAnswers =
      !adapterEmail && inviteeEmail && submission
        ? await this.syncAnswersAtBooking(payload, form, destination, hubspotToken, inviteeEmail, submission)
        : false;

    if (!wroteBooking && !syncedAnswers) {
      throw new OutboxSkipError(
        'booking sync: nothing to write (no meeting start time resolvable and no stage configured)',
      );
    }
    this.log.log(
      `booking sync delivered (booking ${payload.bookingEventId}): ` +
        `${wroteBooking ? `contact updated [${Object.keys(properties).join(', ')}]` : 'no booking properties configured'}` +
        `${syncedAnswers ? ' + submission answers' : ''}`,
    );
  }

  /**
   * The session's stored submission, parsed once for the three consumers in
   * `deliver` (email gate, booking-key fallback, answers sync). Null when the
   * session never persisted one (e.g. a booking with no partial save yet).
   */
  private async loadSubmission(formId: string, sessionId: string): Promise<SubmissionRow | null> {
    const row = await this.db.get<{
      id: string;
      data: unknown;
      score: number;
      completed_at: number | null;
      partial_at: number | null;
      started_at: number;
    }>(
      sql`SELECT id, data, score, completed_at, partial_at, started_at FROM submission
          WHERE form_id = ${formId} AND session_id = ${sessionId} LIMIT 1`,
    );
    if (!row) return null;
    return {
      id: String(row.id),
      data: parseJsonColumn<Record<string, unknown>>(row.data, {}),
      score: Number(row.score) || 0,
      completedAt: row.completed_at == null ? null : Number(row.completed_at),
      // The moment the submission reached its CURRENT phase — what the port's
      // `submittedAt` means. Never the delivery clock: outbox retries/backoff
      // can run hours later, and the date property + Note would lie.
      submittedAt: Number(row.completed_at ?? row.partial_at ?? row.started_at) || Date.now(),
    };
  }

  /**
   * Deliver the submission answers through the standard HubSpot adapter — field
   * mappings, value maps, score/outcome/static properties, Note — keyed on the
   * Calendly invitee's email. Reuses the exact adapter the submit path uses so
   * the two flows can never drift on mapping semantics. Retryable adapter
   * failures propagate and the outbox retries the whole row — safe because the
   * contact write is an idempotent upsert and the Note is the LAST side effect
   * of the whole delivery (see the write-order comment in `deliver`).
   */
  private async syncAnswersAtBooking(
    payload: BookingSyncPayload,
    form: { name: string; config: unknown },
    destination: HubspotDestination,
    token: string,
    inviteeEmail: string,
    submission: SubmissionRow,
  ): Promise<boolean> {
    const { data, score } = submission;

    // Outcome label recomputed exactly as submit time does (engine, stored config).
    const parsed = formConfigSchema.safeParse(form.config);
    const outcomeLabel = parsed.success
      ? (resolveOutcome(
          parsed.data as unknown as FormConfig,
          score,
          data as Parameters<typeof resolveOutcome>[2],
        )?.label ?? null)
      : null;

    // Through the factory — the same construction seam the submit path uses
    // (invariant #7); the token is injected here and never persisted.
    const adapter = createDestination(
      {
        type: 'hubspot',
        hubspot: {
          token,
          fieldMappings: destination.fieldMappings ?? {},
          utmMappings: destination.utmMappings ?? {},
          scoreProperty: destination.scoreProperty ?? undefined,
          dateProperty: destination.dateProperty ?? undefined,
          note: destination.settings?.note,
          valueMaps: destination.valueMaps,
          outcomeProperty: destination.outcomeProperty ?? undefined,
          staticProperties: destination.staticProperties,
          inferCompanyFromEmail: destination.inferCompanyFromEmail,
        },
      },
      this.fetchImpl,
    );
    const result = await adapter.deliver({
      idempotencyKey: `booking:${payload.bookingEventId}:hubspot`,
      submissionId: submission.id,
      formId: payload.formId,
      formName: form.name,
      accountId: payload.accountId,
      sessionId: payload.sessionId,
      score,
      outcomeLabel,
      // Honest phase: a mid-form scheduler books BEFORE the final submit, and
      // the adapter's complete-only extras (Note, score/outcome/static props)
      // must not fire off a partial answer set. Known limit: answers given
      // AFTER the scheduler still reach HubSpot only if the form collects an
      // email — the submit-time delivery keys on that, not on this booking.
      phase: submission.completedAt != null ? 'complete' : 'partial',
      submittedAt: submission.submittedAt,
      // The invitee email rides as the `email` answer the adapter keys on; a
      // stored value would win, but this path only runs when none exists.
      data: { ...data, email: inviteeEmail },
      utm: extractUtm(data),
    });
    return result.delivered;
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

/** The session's submission, parsed and phase-stamped (see `loadSubmission`). */
interface SubmissionRow {
  id: string;
  data: Record<string, unknown>;
  score: number;
  completedAt: number | null;
  submittedAt: number;
}

/**
 * Best-effort respondent email from the stored answers — the BOOKING-KEY
 * fallback only. Deliberately loose (any email-shaped string in any answer):
 * for stamping date/hours on a contact, a probably-right key beats no key.
 */
function looseEmailFromData(data: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string') continue;
    if (/@/.test(value) && (key.toLowerCase().includes('email') || /@[^@]+\.[^@]+$/.test(value))) {
      return value.trim().toLowerCase();
    }
  }
  return null;
}

/**
 * The email the SUBMIT-TIME adapter would have keyed on — a field mapping to
 * the `email` contact property, else a literal `email` answer (mirrors
 * `HubspotDestination.resolveEmail`). This, not the loose heuristic above, is
 * the answers-sync gate: the question is "did the submit delivery already run
 * with a key?", and only the adapter's own semantics can answer it.
 */
function adapterResolvableEmail(
  destination: HubspotDestination,
  data: Record<string, unknown>,
): string | null {
  for (const [stepKey, property] of Object.entries(destination.fieldMappings ?? {})) {
    const value = data[stepKey];
    if (property?.trim() === 'email' && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  const direct = data.email;
  return typeof direct === 'string' && direct.trim() ? direct.trim() : null;
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
