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
   * Stable, event-specific de-duplication key. Submission deliveries use
   * `submission:<id>:<phase>:<destinationType>:<index>`; the booking-time
   * answers sync uses `booking:<bookingEventId>:hubspot`. A retried delivery
   * reuses the same key; distinct events get distinct keys. Webhooks forward it
   * as a header so the RECEIVER can dedupe. NOTE: the HubSpot adapter does not
   * read it — its Note create is not idempotent, which is why every caller must
   * make the Note the LAST side effect of a delivery (nothing retryable after).
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
  /** Epoch-ms the submission reached this phase. */
  submittedAt: number;
  /** The submission answers: fieldName -> value. */
  data: Record<string, unknown>;
  /** UTM values captured for the session (from `submission.data.utm`). */
  utm: Record<string, string>;
}

export interface DestinationResult {
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
