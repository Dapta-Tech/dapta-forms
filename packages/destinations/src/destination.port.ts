/**
 * The SubmissionDestination port — the boundary every submission-sync caller
 * depends on. Concrete integrations (log-only, webhook, HubSpot, …) are selected
 * by configuration, never imported directly by application code. Adding a
 * destination means adding an adapter behind this interface; callers never
 * change. Mirrors the EmailProvider port in @quill/notifications.
 *
 * Reliability contract (identical to the email port): a destination NEVER rolls
 * back or blocks a submission. `deliver` resolves for an outcome it can report;
 * it THROWS only for a transient/retryable failure the durable outbox should
 * retry. A permanent no-op (e.g. HubSpot with no email to key on) resolves with
 * `delivered:false` so the outbox row is marked done, not retried forever.
 */

/** Which integration actually handled (or would handle) the delivery. */
export type DestinationDriver = 'log-only' | 'webhook' | 'hubspot';

/** The configurable destination kinds a form may declare. */
export type DestinationType = 'webhook' | 'hubspot';

/**
 * The snapshot a destination receives for one submission. Built at ENQUEUE time
 * and serialized into the outbox payload, so a later retry delivers exactly what
 * was captured — independent of any subsequent edit to the form or its config.
 */
export interface DestinationContext {
  /**
   * Stable, event-specific de-duplication key.
   *
   * Submission deliveries use
   * `submission:<id>:<phase>:<destinationType>:<destination digest>:<content
   * digest>`, where each digest is a full lower-case SHA-256 hex over canonical
   * JSON: the first of the destination's persisted, non-secret identity, the
   * second of everything in this context except the key itself and
   * `submittedAt`. The booking-time answers sync uses
   * `booking:<bookingEventId>:hubspot`.
   *
   * EQUAL KEYS MEAN THE SAME DELIVERY. A retry reuses its key, and so does a
   * re-submit that changed no answer, because neither is a new thing to send.
   * Anything that changes what is sent, or where it is sent, produces a
   * different key. That is the whole contract a receiver deduping on the
   * forwarded header depends on, so it is content-addressed rather than
   * positional: a key derived from a destination's index in the form config
   * changed meaning whenever a destination was reordered or deleted.
   *
   * Nothing secret is digested. The key is forwarded to the receiver, so a
   * signing secret is deliberately not part of the destination's identity; a
   * rotated secret keeps the same key, which is also the right answer, since
   * rotating one does not create a delivery.
   *
   * NOTE: the HubSpot adapter does not read it — its Note create is not
   * idempotent, which is why every caller must make the Note the LAST side
   * effect of a delivery (nothing retryable after).
   */
  idempotencyKey: string;
  /** The persisted submission id (the domain anchor). */
  submissionId: string;
  formId: string;
  formName: string;
  /** Tenant context asserted by the authenticated backend, never by a browser. */
  accountId: string;
  sessionId: string;
  /** Server-recomputed score (never the client's claim). */
  score: number;
  /** The resolved outcome bucket label, when the form scores to one. */
  outcomeLabel: string | null;
  /** `partial` = an intermediate save; `complete` = the final submit. */
  phase: 'partial' | 'complete';
  /**
   * Epoch-ms the submission reached this phase. Deliberately OUTSIDE the
   * identity above: a later reading of the clock is not a different delivery.
   */
  submittedAt: number;
  /** The submission answers: fieldName -> value. */
  data: Record<string, unknown>;
  /** UTM values captured for the session (from `submission.data.utm`). */
  utm: Record<string, string>;
}

/**
 * What actually crossed the wire, for the admin's delivery history.
 *
 * Deliberately separate from the outbox `payload` (the enqueued snapshot): only
 * this answers "what did my endpoint receive, and what did it say back", which
 * is where every webhook debugging session starts. An adapter that cannot report
 * a single request — HubSpot is a sequence of API calls — simply omits it, and
 * the absence is rendered as "not recorded", never as an empty body.
 *
 * Never carries a credential: the signing secret lives in a header, not the
 * body, and headers are not recorded.
 */
export interface DeliveryTranscript {
  /** The exact request body sent, verbatim. */
  requestBody?: string;
  responseStatus?: number;
  /** The receiver's own body, trimmed and truncated by the adapter. */
  responseBody?: string | null;
}

/**
 * The transcript a FAILED delivery left on its error.
 *
 * A failure is the only delivery anyone ever needs to read back, and it arrives
 * as a thrown error rather than a returned result. Adapters attach what they
 * have — the webhook one carries the request body even when nothing answered —
 * and this reads it without the caller having to know any adapter's error class.
 */
export function transcriptOfError(err: unknown): DeliveryTranscript {
  if (typeof err !== 'object' || err === null) return {};
  const e = err as { requestBody?: unknown; status?: unknown; detail?: unknown };
  return {
    requestBody: typeof e.requestBody === 'string' ? e.requestBody : undefined,
    responseStatus: typeof e.status === 'number' ? e.status : undefined,
    responseBody: typeof e.detail === 'string' ? e.detail : undefined,
  };
}

export interface DestinationResult extends DeliveryTranscript {
  /** True when actually dispatched; false for log-only / a permanent no-op. */
  delivered: boolean;
  driver: DestinationDriver;
  /** Optional human detail (a HubSpot contact id, a skipped-properties note…). */
  detail?: string;
}

export interface SubmissionDestination {
  /** The configured destination this instance speaks for (`log-only` when disabled). */
  readonly type: DestinationType | 'log-only';
  /**
   * Deliver one submission to this destination. Resolves with `delivered:false`
   * for a permanent no-op it can report (marked done, never retried); THROWS for
   * a transient failure so the durable outbox worker retries with backoff.
   */
  deliver(ctx: DestinationContext): Promise<DestinationResult>;
}
