import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { getFormById, parseJsonColumn, resolveProviderToken, sql, type Db } from '@quill/db';
import {
  formConfigSchema,
  formDestinationSchema,
  propertiesFor,
  type FormDestination,
  type HubspotDestination,
} from '@quill/types';
import { resolveOutcome, INVITEE_FIELDS, type FormConfig } from '@quill/engine';
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
  resource?: {
    start_time?: string;
    email?: string;
    /** Invitee identity. `name` is always set; the split pair only sometimes. */
    name?: string;
    first_name?: string;
    last_name?: string;
    /** Present only when the event type asks for an SMS reminder number. */
    text_reminder_number?: string;
    /** The booking form's custom questions, in the order the event type asks them. */
    questions_and_answers?: { question?: string; answer?: string; position?: number }[];
  };
}

/**
 * A custom-question answer that is a phone number, or null.
 *
 * `text_reminder_number` only exists when the event type uses Calendly's native
 * SMS field, and real event types ask for the phone as a CUSTOM question instead
 * ("What is your phone number?"), which arrives here. Guarded twice, because
 * either check alone fails on real data: event types exist whose first question
 * is "Company" (and people have answered it with their phone) and others with
 * free-text "Please share anything...", so the QUESTION must ask for a phone AND
 * the ANSWER must parse as one. Position is irrelevant: the question is found by
 * its text, wherever the event type asks it.
 */
function phoneFromQuestions(
  qa: { question?: string; answer?: string }[] | undefined,
): string | null {
  const asksForPhone = (q: string | undefined) =>
    /tel[eé]fono|phone|celular|m[oó]vil|whatsapp|n[uú]mero/i.test(q ?? '');
  const looksLikePhone = (a: string | undefined) => /^[+()\-.\s\d]{7,}$/.test((a ?? '').trim());
  const hit = (qa ?? []).find((x) => asksForPhone(x.question) && looksLikePhone(x.answer));
  return hit?.answer?.trim() ?? null;
}

/** What the booking page collected about the person, beyond their address. */
interface InviteeDetails {
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}

const NO_INVITEE_DETAILS: InviteeDetails = {
  name: null,
  firstName: null,
  lastName: null,
  phone: null,
};

/**
 * The invitee identity as answer keys, ready to merge into the submission data.
 *
 * Calendly always returns `name` and only sometimes the split pair, so a missing
 * `first_name`/`last_name` is derived from it: everything before the first space
 * is the first name, the remainder the last. That is a heuristic, and it is the
 * same one the booking page itself applies when it splits a single field — a
 * mononym yields a first name and no last, which is the correct outcome.
 */
function inviteeAnswers(details: InviteeDetails): Record<string, string> {
  const out: Record<string, string> = {};
  const full = details.name?.trim() ?? '';
  const space = full.indexOf(' ');
  const first = details.firstName?.trim() || (space > 0 ? full.slice(0, space) : full);
  const last = details.lastName?.trim() || (space > 0 ? full.slice(space + 1).trim() : '');
  if (full) out[INVITEE_FIELDS.name] = full;
  if (first) out[INVITEE_FIELDS.first_name] = first;
  if (last) out[INVITEE_FIELDS.last_name] = last;
  if (details.phone?.trim()) out[INVITEE_FIELDS.phone] = details.phone.trim();
  return out;
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
 *      epoch-ms of the day the lead BOOKED, in `dateTimezone` (HubSpot `date`
 *      properties require midnight UTC) — and upserts the contact by email.
 *
 * The two time properties answer different questions and are gated
 * differently. `hoursProperty` is *when the meeting is*, so it needs a start
 * time and is skipped without one. `dateProperty` is *when the booking
 * happened*, which is known unconditionally — it is what monthly "meetings
 * booked" reporting counts by, and stamping it with the meeting's day would
 * push a booking made on the 31st into next month.
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

    // --- Calendly enrichment (event start + invitee identity) ----------------
    let startMs = payload.startTime;
    let inviteeEmail: string | null = null;
    let invitee: InviteeDetails = NO_INVITEE_DETAILS;
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
          'CALENDLY_API_TOKEN not set. Booking sync proceeds without Calendly enrichment',
        );
      } else {
        const [event, fetchedInvitee] = await Promise.all([
          payload.eventUri ? this.calendlyGet(payload.eventUri, token) : null,
          payload.inviteeUri ? this.calendlyGet(payload.inviteeUri, token) : null,
        ]);
        const fetchedStart = event?.resource?.start_time;
        if (fetchedStart) {
          const parsed = Date.parse(fetchedStart);
          if (Number.isFinite(parsed)) startMs = parsed;
        }
        const fetchedEmail = fetchedInvitee?.resource?.email?.trim();
        if (fetchedEmail) inviteeEmail = fetchedEmail.toLowerCase();
        // The rest of the identity the booking page collected. Kept whether or
        // not the account also runs the provider's own CRM integration: both
        // write the same values to the same contact, and the upsert is
        // idempotent, so there is no ordering to arbitrate.
        invitee = {
          name: fetchedInvitee?.resource?.name?.trim() || null,
          firstName: fetchedInvitee?.resource?.first_name?.trim() || null,
          lastName: fetchedInvitee?.resource?.last_name?.trim() || null,
          // The structured SMS field wins; a custom question is the fallback.
          phone:
            fetchedInvitee?.resource?.text_reminder_number?.trim() ||
            phoneFromQuestions(fetchedInvitee?.resource?.questions_and_answers) ||
            null,
        };
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
    // The booking DAY — when the lead booked, not when the meeting is. Deliberately
    // NOT gated on `startMs`: a provider that reports no start time still tells us
    // a booking happened, and that is the whole fact this property records.
    if (sync?.dateProperty?.trim()) {
      const bookedAtMs = payload.bookedAt ?? (await this.bookedAtFallback(payload, submission));
      if (bookedAtMs != null) {
        properties[sync.dateProperty.trim()] = String(
          dayMidnightMs(bookedAtMs, sync.dateTimezone, this.log),
        );
      }
    }
    // The meeting START — only knowable once a start time resolved.
    if (sync?.hoursProperty?.trim() && startMs != null && Number.isFinite(startMs)) {
      properties[sync.hoursProperty.trim()] = String(startMs);
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
      throw new OutboxSkipError('HUBSPOT_PRIVATE_APP_TOKEN not set. Booking sync logged property keys only');
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
        ? await this.syncAnswersAtBooking(
            payload,
            form,
            destination,
            hubspotToken,
            inviteeEmail,
            submission,
            invitee,
          )
        : false;

    if (!wroteBooking && !syncedAnswers) {
      // "writable", not "configured": an hoursProperty with no resolvable start
      // time is configured and still contributes nothing.
      throw new OutboxSkipError(
        'booking sync: nothing to write (no booking properties writable and no answers to sync)',
      );
    }
    this.log.log(
      `booking sync delivered (booking ${payload.bookingEventId}): ` +
        `${wroteBooking ? `contact updated [${Object.keys(properties).join(', ')}]` : 'no booking properties configured'}` +
        `${syncedAnswers ? ' + submission answers' : ''}`,
    );
  }

  /**
   * When the booking happened, for a row enqueued BEFORE the payload carried
   * `bookedAt` (in-flight at deploy). The `booking_event` row this sync is for
   * is stamped with exactly that moment, so read it — the same value a fresh
   * payload would have carried, and a stable one under retry.
   *
   * The delivery clock is the last resort and must stay unreachable in practice:
   * the outbox row is anchored to this booking event, so the row exists unless
   * someone deleted it, and re-reading the clock on every attempt would let two
   * retries straddling midnight record two different days for one booking.
   */
  private async bookedAtFallback(
    payload: BookingSyncPayload,
    submission: SubmissionRow | null,
  ): Promise<number | null> {
    // A primary-key lookup, narrowed by `form_id` as well so every read in this
    // file stays inside the form the account gate above already resolved. A DB
    // error is left to THROW: the outbox contract says a transport failure
    // retries, and swallowing it here would quietly stamp a different, entirely
    // plausible day instead.
    const row = await this.db.get<{ created_at: number }>(
      sql`SELECT created_at FROM booking_event
          WHERE id = ${payload.bookingEventId} AND form_id = ${payload.formId} LIMIT 1`,
    );
    const createdAt = row == null ? null : Number(row.created_at);
    if (createdAt != null && Number.isFinite(createdAt)) return createdAt;
    // `submittedAt` ends in its own `|| Date.now()` (see `loadSubmission`) —
    // harmless there, but here it would smuggle the delivery clock past the
    // guarantee this method exists to make. Take it only when it is a real
    // stored timestamp.
    if (submission && Number.isFinite(submission.submittedAt) && submission.submittedAt > 0) {
      return submission.submittedAt;
    }
    // Both records gone — only manual DB surgery gets here. There is no honest
    // answer left, and the delivery clock is the one answer that must never be
    // given: it would look right, and it would differ between retries. Skip the
    // property; the stage stamp and the meeting time still go out, and an
    // absent date is something a human can see and correct.
    this.log.warn(
      `booking sync: booking ${payload.bookingEventId} has no booked-at and no submission. Booking day not written`,
    );
    return null;
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
    invitee: InviteeDetails,
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
      // stored value would win, but this path only runs when none exists. The
      // rest of the invitee identity rides on reserved `@invitee_*` keys, so an
      // author maps it to CRM properties exactly like any answer — and a real
      // ANSWER always wins, since the form asking the question outranks whatever
      // the booking page happened to collect.
      data: { ...inviteeAnswers(invitee), ...data, email: inviteeEmail },
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
      this.log.warn(`calendly fetch rejected (HTTP ${res.status}): proceeding without enrichment`);
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
        `hubspot booking upsert rejected (HTTP ${res.status}). Check the configured booking properties`,
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
  for (const [stepKey, target] of Object.entries(destination.fieldMappings ?? {})) {
    const value = data[stepKey];
    if (propertiesFor(target).includes('email') && typeof value === 'string' && value.trim()) {
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

/**
 * UTC-midnight epoch-ms of the calendar day `epochMs` falls on **in `timezone`**
 * — the value a HubSpot `date` property takes, for the day a human in that zone
 * would name. Blank/absent zone = UTC (the platform default; this product is
 * self-hosted and has no business assuming anyone's office).
 *
 * An unrecognised zone WARNS and falls back to UTC rather than throwing: a typo
 * in a config field must not turn a delivery into a retry loop, and a day that
 * is off by hours beats no booking record at all.
 */
export function dayMidnightMs(epochMs: number, timezone?: string, log?: Logger): number {
  const zone = timezone?.trim();
  if (zone) {
    try {
      // `formatToParts` and not a formatted string: reading the parts BY TYPE is
      // locale-independent, where parsing "YYYY-MM-DD" assumes an ICU build that
      // renders `en-CA` in ISO order. On a small-icu Node it does not, and every
      // zone would degrade to UTC without anything looking wrong.
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date(epochMs));
      const at = (type: string) => Number(parts.find((p) => p.type === type)?.value);
      const [y, m, d] = [at('year'), at('month'), at('day')];
      if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
        return Date.UTC(y, m - 1, d);
      }
    } catch {
      // Fall through to UTC.
    }
    // The zone is author-entered config, never PII — naming it is what makes the
    // warning actionable. Quoted through JSON so an author cannot smuggle a
    // newline into the log and forge a line of their own.
    log?.warn(
      `booking sync: unusable dateTimezone ${JSON.stringify(zone)}. Booking day computed in UTC instead`,
    );
  }
  return utcMidnightMs(epochMs);
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
