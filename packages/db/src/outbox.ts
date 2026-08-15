/**
 * The transactional OUTBOX (B7 / audit DM1). Every durable side-effect that
 * would otherwise be fire-and-forget — submission emails today, outbound
 * webhooks tomorrow — is recorded as an `outbox` row the instant it is due, and
 * a worker (see apps/api/src/outbox.worker.ts) drains it with retry +
 * exponential backoff.
 *
 * Why this matters:
 *   - No silent loss. A provider outage or a transient network error no longer
 *     drops the effect on the floor — the row survives and retries.
 *   - A durable delivery log. status/attempts/last_error on each row is the
 *     record of what was attempted and why it failed.
 *
 * This module is pure DB (depends only on the `Db` port) and dialect-agnostic:
 * the same code runs on SQLite (clone-and-run) and Postgres (prod). The *what to
 * do* for each row lives in the API app; this module owns only the queue
 * mechanics. `subject_uid` is the domain anchor a row belongs to (a submission
 * id for email rows) so related pending work can be cancelled together.
 *
 * Concurrency (H2): due rows are atomically claimed before processing, with a
 * fresh opaque token in `claimed_by` for every claim generation. On Postgres
 * each claim uses `FOR UPDATE SKIP LOCKED`; SQLite serializes its one-row
 * `UPDATE ... RETURNING`. A stale or ambiguous worker cannot settle a newer
 * generation because every settlement fences on that token. This is
 * still at-least-once: a crash after an external effect and before settlement
 * can replay the effect after lease expiry. A claim older than `staleClaimMs`
 * is reclaimable so crashed rows are not stranded.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from './client';

/**
 * `email` = submission lifecycle emails; `webhook`/`hubspot` = pluggable
 * submission destinations (drained by the same worker + retry machinery);
 * `booking_sync` = CRM sync of a scheduling callback (booking_event → HubSpot
 * contact update, enriched via Calendly); `analytics` = a first-party product
 * analytics event about OUR OWN users (signup, publish, activation), which is a
 * network call and therefore never fired inline from a request handler;
 * `dapta_sync` = pushing a new account's onboarding answers into the Dapta
 * estate (IAM responses + the HubSpot contact-sync flow), same never-inline
 * rule. Adding a kind here is all the queue needs — the delivery logic lives in
 * the API (DestinationEffects / BookingSyncEffects / AnalyticsCapture /
 * DaptaSyncDelivery).
 */
export const OUTBOX_KINDS = [
  'webhook',
  'email',
  'hubspot',
  'booking_sync',
  'analytics',
  'dapta_sync',
] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];
/**
 * `skipped` = deliberately not performed (e.g. an email row whose tenant
 * context is unrecoverable on a transport that requires it) — recorded ONCE
 * with a reason, never retried. Distinct from `failed` (exhausted retries).
 */
export const OUTBOX_STATUSES = ['pending', 'done', 'failed', 'skipped'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/**
 * The `action` of a row written by the admin's "Send test" button.
 *
 * Defined in @quill/types and re-exported here so a caller already importing the
 * queue does not need a second import for the one value that labels its rows.
 */
export { WEBHOOK_PING_ACTION } from '@quill/types';

export interface OutboxRow {
  id: string;
  kind: OutboxKind;
  action: string;
  subjectUid: string | null;
  accountId: string | null;
  webhookId: string | null;
  payload: string | null;
  status: OutboxStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  /** Lease marker: epoch-ms this row was claimed by a worker (null = unclaimed). */
  claimedAt: number | null;
  /** Immutable opaque token for this claim generation (prefix is diagnostics). */
  claimedBy: string | null;
  /**
   * The last attempt's transcript. `null` = not recorded — a row from before
   * this existed, or a kind whose adapter reports no single request. Never
   * "an empty body was sent".
   */
  requestBody: string | null;
  responseStatus: number | null;
  responseBody: string | null;
}

/**
 * One claim generation. `claimedAt` is a diagnostic snapshot only; fencing
 * predicates use the immutable `claimedBy` token.
 */
export interface OutboxClaim {
  claimedAt: number;
  claimedBy: string;
}

/** Extract the required lease identity from a row returned by `claimDueOutbox`. */
export function claimIdentityOf(row: Pick<OutboxRow, 'claimedAt' | 'claimedBy'>): OutboxClaim {
  if (row.claimedAt === null || row.claimedBy === null) {
    throw new Error('claimed outbox row is missing its claim identity');
  }
  return { claimedAt: row.claimedAt, claimedBy: row.claimedBy };
}

export interface EnqueueOutboxInput {
  kind: OutboxKind;
  action: string;
  subjectUid?: string | null;
  accountId?: string | null;
  webhookId?: string | null;
  /** Serialized JSON body for the side-effect (e.g. the email notification). */
  payload?: string | null;
  maxAttempts?: number;
  /** Epoch-ms; injected so callers/tests control the clock. Defaults to Date.now(). */
  now?: number;
  /**
   * Epoch-ms at which this row first becomes due. Defaults to `now` (immediate).
   * Set it in the FUTURE to schedule delivery — e.g. a reminder at `start − lead`.
   * The worker drains rows with `next_attempt_at <= now`, so a future value stays
   * dormant until its time.
   */
  nextAttemptAt?: number;
}

/** Default retry ceiling; overridable per row (OUTBOX_MAX_ATTEMPTS at the worker). */
export const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Exponential backoff for the NEXT retry, given the number of attempts already
 * made (1 after the first failure). 1s, 2s, 4s, 8s … capped at 5 min. Kept pure
 * so the worker can compute `nextAttemptAt = now + backoffMs(attempts)`.
 */
export function backoffMs(attempts: number): number {
  const base = 1000;
  const cap = 5 * 60_000;
  return Math.min(cap, base * 2 ** Math.max(0, attempts - 1));
}

/** Record a due unit of work. Returns the new row id. */
export async function enqueueOutbox(db: Db, input: EnqueueOutboxInput): Promise<string> {
  const id = randomUUID();
  const now = input.now ?? Date.now();
  const dueAt = input.nextAttemptAt ?? now;
  await db.run(
    sql`INSERT INTO outbox
          (id, kind, action, subject_uid, account_id, webhook_id, payload,
           status, attempts, max_attempts, next_attempt_at, last_error, created_at, updated_at)
        VALUES (${id}, ${input.kind}, ${input.action}, ${input.subjectUid ?? null},
          ${input.accountId ?? null}, ${input.webhookId ?? null}, ${input.payload ?? null},
          'pending', 0, ${input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS}, ${dueAt}, NULL, ${now}, ${now})`,
  );
  return id;
}

/**
 * Delete still-PENDING rows matching a subject + kind + action — used to cancel
 * scheduled sends before they fire. Never touches rows already `done`/`failed`.
 */
export async function deletePendingOutbox(
  db: Db,
  filter: { subjectUid: string; kind: OutboxKind; action: string },
): Promise<void> {
  await db.run(
    sql`DELETE FROM outbox
        WHERE status = 'pending' AND subject_uid = ${filter.subjectUid}
          AND kind = ${filter.kind} AND action = ${filter.action}`,
  );
}

function mapRow(r: Record<string, unknown>): OutboxRow {
  return {
    id: String(r.id),
    kind: r.kind as OutboxKind,
    action: String(r.action),
    subjectUid: (r.subject_uid as string | null) ?? null,
    accountId: (r.account_id as string | null) ?? null,
    webhookId: (r.webhook_id as string | null) ?? null,
    payload: (r.payload as string | null) ?? null,
    status: r.status as OutboxStatus,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    nextAttemptAt: Number(r.next_attempt_at),
    lastError: (r.last_error as string | null) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    claimedAt: r.claimed_at == null ? null : Number(r.claimed_at),
    claimedBy: (r.claimed_by as string | null) ?? null,
    requestBody: (r.request_body as string | null) ?? null,
    responseStatus: r.response_status == null ? null : Number(r.response_status),
    responseBody: (r.response_body as string | null) ?? null,
  };
}

/** Default lease before a claim is considered stale and reclaimable (5 min). */
export const DEFAULT_STALE_CLAIM_MS = 5 * 60_000;
/** Default external-effect cap; always below the stale lease. */
export const DEFAULT_MAX_DELIVERY_MS = Math.floor(DEFAULT_STALE_CLAIM_MS * 0.4);
/** The most rows one drain may execute before yielding to its next poll. */
export const DEFAULT_OUTBOX_CLAIM_LIMIT = 50;

export interface ClaimOptions {
  /** Max rows to claim in one call. */
  limit?: number;
  /**
   * Diagnostic worker prefix (host:pid). The queue appends a fresh UUID for
   * every claimed row, so callers cannot supply or reuse a claim token.
   */
  workerId?: string;
  /** A claim older than this (ms) is reclaimable — a crashed worker's rows. */
  staleClaimMs?: number;
}

/**
 * Atomically claim up to `limit` due rows and return them (H2). Each row is
 * claimed in its own statement so `claimed_by` can carry a fresh opaque token
 * for that exact generation. A row is due when `status='pending'` and
 * `next_attempt_at <= now`; it is claimable when it is unclaimed OR its claim
 * is stale (older than `staleClaimMs`). `status` stays `pending` throughout
 * (the lifecycle transitions live in markOutbox*); a retry clears the claim so
 * the row can be picked up again after its backoff.
 */
export async function claimDueOutbox(
  db: Db,
  now: number,
  opts: ClaimOptions = {},
): Promise<OutboxRow[]> {
  const limit = opts.limit ?? DEFAULT_OUTBOX_CLAIM_LIMIT;
  const workerPrefix = opts.workerId ?? 'worker';
  const staleBefore = now - (opts.staleClaimMs ?? DEFAULT_STALE_CLAIM_MS);
  const claimable = sql`status = 'pending' AND next_attempt_at <= ${now}
      AND (claimed_at IS NULL OR claimed_at <= ${staleBefore})`;
  const claimed: OutboxRow[] = [];
  for (let i = 0; i < limit; i++) {
    const claimToken = `${workerPrefix}#${randomUUID()}`;
    const excludeClaimed =
      claimed.length === 0
        ? sql``
        : sql` AND id NOT IN (${sql.join(
            claimed.map((row) => sql`${row.id}`),
            sql`, `,
          )})`;
    const selectDue =
      db.dialect === 'postgres'
        ? sql`SELECT id FROM outbox WHERE ${claimable}${excludeClaimed}
              ORDER BY next_attempt_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`
        : sql`SELECT id FROM outbox WHERE ${claimable}${excludeClaimed}
              ORDER BY next_attempt_at ASC LIMIT 1`;
    // Postgres locks one row with SKIP LOCKED; SQLite serializes its one-row
    // UPDATE. Both atomically write the fresh token with the lease timestamp.
    const rows = await db.all<Record<string, unknown>>(
      db.dialect === 'postgres'
        ? sql`UPDATE outbox SET claimed_at = ${now}, claimed_by = ${claimToken}
              WHERE id = ANY (ARRAY(${selectDue}))
              RETURNING *`
        : sql`UPDATE outbox SET claimed_at = ${now}, claimed_by = ${claimToken}
              WHERE id IN (${selectDue})
              RETURNING *`,
    );
    if (rows.length === 0) break;
    claimed.push(...rows.map(mapRow));
  }
  return claimed;
}

/**
 * What actually crossed the wire on an attempt, as the queue records it.
 *
 * Every field is optional and absent means NOT RECORDED — an adapter with no
 * single request to report (HubSpot is a sequence of calls) writes nothing here,
 * and a NULL column must never be read as "an empty body was sent".
 */
export interface DeliveryTranscript {
  requestBody?: string;
  responseStatus?: number;
  responseBody?: string | null;
}

/**
 * How much of each body survives.
 *
 * The request is ours and structured, so it is capped generously — a form with
 * fifty answers still fits. The response belongs to somebody else and a failing
 * endpoint routinely answers with an entire HTML error page, so it is capped
 * hard: enough to carry a JSON error, not enough to bloat the queue table.
 */
const MAX_REQUEST_BODY = 8_000;
const MAX_RESPONSE_BODY = 2_000;

const clip = (v: string, max: number): string => (v.length > max ? `${v.slice(0, max)}…` : v);

/**
 * The transcript columns for an UPDATE, or nothing at all.
 *
 * An attempt that reported no transcript must LEAVE the stored one alone rather
 * than null it: the last retry of a webhook whose host stopped resolving has no
 * response to record, and wiping the previous attempt's would throw away the
 * only evidence of what the endpoint used to say.
 */
function transcriptSets(t: DeliveryTranscript | undefined) {
  if (!t) return [];
  const sets = [];
  if (t.requestBody !== undefined)
    sets.push(sql`request_body = ${clip(t.requestBody, MAX_REQUEST_BODY)}`);
  if (t.responseStatus !== undefined) sets.push(sql`response_status = ${t.responseStatus}`);
  if (t.responseBody !== undefined)
    sets.push(sql`response_body = ${t.responseBody === null ? null : clip(t.responseBody, MAX_RESPONSE_BODY)}`);
  return sets;
}

function claimedPendingWhere(id: string, claim: OutboxClaim) {
  return sql`id = ${id} AND status = 'pending' AND claimed_by = ${claim.claimedBy}`;
}

async function settlementApplied(db: Db, query: Parameters<Db['get']>[0]): Promise<boolean> {
  return (await db.get<{ id: string }>(query)) !== undefined;
}

/**
 * Mark the current worker's claimed row delivered, keeping what crossed the
 * wire. Returns false if it lost the lease.
 */
export async function markOutboxDone(
  db: Db,
  id: string,
  now: number,
  transcript: DeliveryTranscript | undefined,
  claim: OutboxClaim,
): Promise<boolean> {
  const sets = [
    sql`status = 'done'`,
    sql`updated_at = ${now}`,
    sql`last_error = NULL`,
    ...transcriptSets(transcript),
  ];
  return settlementApplied(
    db,
    sql`UPDATE outbox SET ${sql.join(sets, sql`, `)} WHERE ${claimedPendingWhere(id, claim)}
        RETURNING id`,
  );
}

/**
 * Record a failed attempt and schedule the next retry with backoff. `attempts`
 * is the new (incremented) count; the row stays `pending` so the worker picks it
 * up again once `next_attempt_at` passes. Returns false if it lost the lease.
 */
export async function markOutboxRetry(
  db: Db,
  id: string,
  args: { attempts: number; error: string; now?: number; transcript?: DeliveryTranscript },
  claim: OutboxClaim,
): Promise<boolean> {
  const now = args.now ?? Date.now();
  const nextAt = now + backoffMs(args.attempts);
  // Clear the claim so the row is reclaimable once its backoff elapses.
  const sets = [
    sql`attempts = ${args.attempts}`,
    sql`next_attempt_at = ${nextAt}`,
    sql`last_error = ${args.error.slice(0, 1000)}`,
    sql`updated_at = ${now}`,
    sql`claimed_at = NULL`,
    sql`claimed_by = NULL`,
    ...transcriptSets(args.transcript),
  ];
  return settlementApplied(
    db,
    sql`UPDATE outbox SET ${sql.join(sets, sql`, `)} WHERE ${claimedPendingWhere(id, claim)}
        RETURNING id`,
  );
}

/**
 * Record a deadline while an external effect may still finish. The row remains
 * pending and retains its token and lease, so a late outcome can fence-settle
 * the same generation without a second attempt increment.
 */
export async function markOutboxTimedOut(
  db: Db,
  id: string,
  args: { attempts: number; error: string; now?: number; transcript?: DeliveryTranscript },
  claim: OutboxClaim,
): Promise<boolean> {
  const now = args.now ?? Date.now();
  const sets = [
    sql`attempts = ${args.attempts}`,
    sql`next_attempt_at = ${now + backoffMs(args.attempts)}`,
    sql`last_error = ${args.error.slice(0, 1000)}`,
    sql`updated_at = ${now}`,
    ...transcriptSets(args.transcript),
  ];
  return settlementApplied(
    db,
    sql`UPDATE outbox SET ${sql.join(sets, sql`, `)} WHERE ${claimedPendingWhere(id, claim)}
        RETURNING id`,
  );
}

/** Number of pending claims whose lease is still live at `now`. */
export async function countLiveOutboxClaims(
  db: Db,
  now: number,
  staleClaimMs = DEFAULT_STALE_CLAIM_MS,
): Promise<number> {
  const row = await db.get<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM outbox
        WHERE status = 'pending' AND claimed_at IS NOT NULL
          AND claimed_at > ${now - staleClaimMs}`,
  );
  return Number(row?.n ?? 0);
}

/**
 * Deliberately not performed — terminal on the FIRST decision (no retry
 * schedule burned), with the reason kept as the log record. Returns false if it
 * lost the lease.
 */
export async function markOutboxSkipped(
  db: Db,
  id: string,
  args: { reason: string; now?: number },
  claim: OutboxClaim,
): Promise<boolean> {
  const now = args.now ?? Date.now();
  return settlementApplied(
    db,
    sql`UPDATE outbox
        SET status = 'skipped', last_error = ${args.reason.slice(0, 1000)}, updated_at = ${now}
        WHERE ${claimedPendingWhere(id, claim)}
        RETURNING id`,
  );
}

/**
 * Give up: the row exhausted its retries. Terminal state; kept as the log.
 * Returns false if it lost the lease.
 */
export async function markOutboxFailed(
  db: Db,
  id: string,
  args: { attempts: number; error: string; now?: number; transcript?: DeliveryTranscript },
  claim: OutboxClaim,
): Promise<boolean> {
  const now = args.now ?? Date.now();
  const sets = [
    sql`status = 'failed'`,
    sql`attempts = ${args.attempts}`,
    sql`last_error = ${args.error.slice(0, 1000)}`,
    sql`updated_at = ${now}`,
    ...transcriptSets(args.transcript),
  ];
  return settlementApplied(
    db,
    sql`UPDATE outbox SET ${sql.join(sets, sql`, `)} WHERE ${claimedPendingWhere(id, claim)}
        RETURNING id`,
  );
}

/**
 * Record a delivery that already happened, in its final state.
 *
 * The admin's test delivery is synchronous on purpose — the author clicks and
 * waits for the answer — so it never passes through the queue. That does not
 * make it any less of a delivery: it is a real signed POST to the real endpoint,
 * and it is very often the ONLY delivery a form has when someone is wiring one
 * up. Leaving it out of the history meant the log stayed empty during exactly
 * the session it existed to help.
 *
 * Inserted TERMINAL, never `pending`: enqueueing and then settling would leave a
 * window in which the worker could claim the row and deliver it a second time.
 * `next_attempt_at` is set far past for the same reason — nothing due, ever.
 */
export async function recordSettledDelivery(
  db: Db,
  input: {
    kind: OutboxKind;
    action: string;
    accountId: string;
    subjectUid?: string | null;
    payload: string;
    status: 'done' | 'failed';
    error?: string | null;
    transcript?: DeliveryTranscript;
    now?: number;
  },
): Promise<string> {
  const id = randomUUID();
  const now = input.now ?? Date.now();
  const t = input.transcript ?? {};
  await db.run(
    sql`INSERT INTO outbox
          (id, kind, action, subject_uid, account_id, webhook_id, payload, status,
           attempts, max_attempts, next_attempt_at, last_error, created_at, updated_at,
           request_body, response_status, response_body)
        VALUES (${id}, ${input.kind}, ${input.action}, ${input.subjectUid ?? null},
                ${input.accountId}, ${null}, ${input.payload}, ${input.status},
                ${1}, ${1}, ${Number.MAX_SAFE_INTEGER}, ${input.error?.slice(0, 1000) ?? null},
                ${now}, ${now},
                ${t.requestBody === undefined ? null : clip(t.requestBody, MAX_REQUEST_BODY)},
                ${t.responseStatus ?? null},
                ${t.responseBody == null ? null : clip(t.responseBody, MAX_RESPONSE_BODY)})`,
  );
  return id;
}

/** Inspect the queue / delivery log (tests, the admin deliveries view). */
export async function listOutbox(
  db: Db,
  filter: {
    status?: OutboxStatus;
    kind?: OutboxKind;
    subjectUid?: string;
    /** Scope to one account — required by any admin-facing caller. */
    accountId?: string;
  } = {},
): Promise<OutboxRow[]> {
  const conds = [sql`1 = 1`];
  if (filter.status) conds.push(sql`status = ${filter.status}`);
  if (filter.kind) conds.push(sql`kind = ${filter.kind}`);
  if (filter.subjectUid) conds.push(sql`subject_uid = ${filter.subjectUid}`);
  if (filter.accountId) conds.push(sql`account_id = ${filter.accountId}`);
  const where = sql.join(conds, sql` AND `);
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT * FROM outbox WHERE ${where} ORDER BY created_at ASC`,
  );
  return rows.map(mapRow);
}

/** One delivery of this form's, in the terms the person who owns the form has. */
export interface FormDelivery {
  id: string;
  /** `booking_sync`, `webhook`, `hubspot`, `email` — what was being delivered. */
  kind: OutboxKind;
  /**
   * `done` = landed; `pending` = queued or between retries; `failed` = retries
   * exhausted; `skipped` = a permanent gap, recorded once and never retried.
   */
  status: OutboxStatus;
  /**
   * Which lifecycle moment enqueued it — `partial`/`complete` for destinations,
   * `submission_received`/`submission_confirmed` for email, `crm_update` for a
   * booking sync. Two rows of the same kind differ only by this and their time.
   */
  action: string;
  /** The reason the worker recorded. This is the whole point of the view. */
  lastError: string | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  /**
   * What actually crossed the wire. `null` = not recorded (a row older than the
   * feature, or a kind with no single request to report) — the UI must say that
   * rather than render an empty body.
   */
  requestBody: string | null;
  responseStatus: number | null;
  responseBody: string | null;
}

/**
 * Kept for the callers that only ever want what did not land. Same rows, same
 * shape — the narrower status union is what those call sites read.
 */
export type FailedDelivery = FormDelivery & { status: 'failed' | 'skipped' };

/** Everything a history read can narrow by. All optional; see the defaults. */
export interface FormDeliveryQuery {
  /** Restrict to these kinds. Empty/absent = every kind. Applied IN SQL. */
  kinds?: OutboxKind[];
  /** Restrict to these statuses. Absent = only what did not land. */
  statuses?: OutboxStatus[];
  /** How many matching rows to return. */
  limit?: number;
  /** How many rows to look at before giving up — see {@link DEFAULT_DELIVERY_SCAN_LIMIT}. */
  scanLimit?: number;
}

/**
 * One form's deliveries, newest first.
 *
 * Nothing in the admin surfaced the outbox, so a delivery that died — an expired
 * CRM token, a disconnected scheduling provider, a form with no resolvable
 * respondent email — existed only in server logs. From the outside everything
 * looked fine: the respondent submitted, the booking succeeded, the confirmation
 * arrived. The lead simply never reached the CRM, and the person who owned the
 * form had no way to find out.
 *
 * The form is matched from the row's serialized payload rather than a column:
 * `outbox` is deliberately generic (kind + payload), and adding a form column
 * would mean a destructive migration on a table every deployment already has.
 * The account IS a column, so the scope that matters for isolation is enforced
 * in SQL; the form filter narrows within one account's own rows.
 *
 * `kinds` narrows IN SQL, and that is what makes asking for `done` rows viable:
 * successful deliveries are by far the largest part of this table, so a history
 * read that could not restrict to one integration would drag every landed email
 * through the scan window to find a handful of webhooks.
 */
export async function listFormDeliveries(
  db: Db,
  accountId: string,
  formId: string,
  query: FormDeliveryQuery = {},
): Promise<FormDelivery[]> {
  const {
    kinds,
    statuses = ['failed', 'skipped'],
    limit = 50,
    scanLimit = DEFAULT_DELIVERY_SCAN_LIMIT,
  } = query;
  // An empty list would render as `IN ()` — a syntax error on both dialects.
  // Absent means "every kind"; explicitly empty means the caller narrowed to
  // nothing, and nothing is the honest answer.
  if (kinds?.length === 0 || statuses.length === 0) return [];

  const conds = [sql`account_id = ${accountId}`, sql`status IN (${bindList(statuses)})`];
  if (kinds?.length) conds.push(sql`kind IN (${bindList(kinds)})`);
  const where = sql.join(conds, sql` AND `);

  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT * FROM outbox
        WHERE ${where}
        ORDER BY updated_at DESC
        LIMIT ${scanLimit}`,
  );
  const out: FormDelivery[] = [];
  for (const raw of rows) {
    const row = mapRow(raw);
    if (!payloadTargetsForm(row.payload, formId)) continue;
    out.push({
      id: row.id,
      kind: row.kind,
      status: row.status,
      action: row.action,
      lastError: row.lastError,
      attempts: row.attempts,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      requestBody: row.requestBody,
      responseStatus: row.responseStatus,
      responseBody: row.responseBody,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Deliveries for one form that ended without landing — the default narrowing. */
export async function listFailedDeliveries(
  db: Db,
  accountId: string,
  formId: string,
  limit = 50,
): Promise<FailedDelivery[]> {
  const rows = await listFormDeliveries(db, accountId, formId, { limit });
  return rows as FailedDelivery[];
}

/**
 * How many rows a single read will look at.
 *
 * The form is matched in JS, so the SELECT cannot narrow to it and an account
 * with a long-broken destination would otherwise drag its entire failure history
 * into memory on every page load. Deliberately larger than any caller's `limit`:
 * this bounds the SCAN, the caller bounds the ANSWER, and the two must not be the
 * same number or a caller asking for 50 would stop looking after 50 rows of which
 * only some match.
 */
const DEFAULT_DELIVERY_SCAN_LIMIT = 500;

/**
 * One bound placeholder per value, for an `IN (…)` list.
 *
 * The values are a fixed vocabulary (`OutboxKind` / `OutboxStatus`), but they
 * arrive from a query string, so they go through the driver as parameters like
 * every other user-supplied value — never spliced into the statement text.
 */
function bindList(values: readonly string[]) {
  return sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );
}

/**
 * The form a row's payload names, across the two shapes the queue carries.
 *
 *  - TOP-LEVEL `formId` — `booking_sync` rows (`BookingSyncPayload`).
 *  - `ctx.formId` — destination rows (`webhook`/`hubspot`), whose payload is
 *    `{ destination, ctx }` because the delivery needs both halves on retry.
 *
 * Reading only the top level is what made every webhook and HubSpot failure
 * invisible in the admin — including in the per-form panel built to show them.
 * `booking_sync` was the only kind that matched, so the tests passed and the hole
 * stayed hidden.
 *
 * Widening this cannot cross a tenant boundary: the SQL above already restricts
 * to one `account_id`, so this narrows WITHIN rows the caller already owns.
 *
 * Malformed payloads simply yield null.
 */
function payloadFormId(payload: string | null): string | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as { formId?: unknown; ctx?: { formId?: unknown } };
    if (typeof parsed.formId === 'string') return parsed.formId;
    if (typeof parsed.ctx?.formId === 'string') return parsed.ctx.formId;
    return null;
  } catch {
    return null;
  }
}

/** Does this row's payload name the form? Malformed payloads simply do not match. */
function payloadTargetsForm(payload: string | null, formId: string): boolean {
  return payloadFormId(payload) === formId;
}

/** One form's failed deliveries of a single kind, rolled up. */
export interface FormDeliveryFailures {
  formId: string;
  /** How many rows ended without landing, within the scanned window. */
  count: number;
  /** The reason on the most recent of them — the worker's own words. */
  lastError: string | null;
  /** When that most recent failure was last touched. */
  lastAt: number;
}

/**
 * Failed deliveries of one kind, grouped by form, for an entire account.
 *
 * The per-form view answers "what went wrong with THIS form"; an account-level
 * inventory needs the same answer for every form at once, and asking it one form
 * at a time would be N queries to render one table. Same rows, same account
 * scope in SQL, grouped in JS because the form lives in a serialized payload
 * rather than a column (see {@link payloadFormId}).
 *
 * Attribution is per FORM, not per destination: `ctx` carries `formId`, not the
 * destination's id, so a form with two webhooks reports the same figure for
 * both. That is a property of what the queue records, and the caller should say
 * so rather than imply otherwise.
 */
export async function summarizeFailedDeliveriesByForm(
  db: Db,
  accountId: string,
  kind: OutboxKind,
  scanLimit = DEFAULT_DELIVERY_SCAN_LIMIT,
): Promise<FormDeliveryFailures[]> {
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT * FROM outbox
        WHERE account_id = ${accountId} AND kind = ${kind} AND status IN ('failed', 'skipped')
        ORDER BY updated_at DESC
        LIMIT ${scanLimit}`,
  );
  const byForm = new Map<string, FormDeliveryFailures>();
  for (const raw of rows) {
    const row = mapRow(raw);
    const formId = payloadFormId(row.payload);
    if (!formId) continue;
    const hit = byForm.get(formId);
    if (hit) {
      hit.count += 1;
      continue;
    }
    // Rows arrive newest-first, so the first one seen for a form is the one whose
    // error and timestamp describe the failure the reader cares about.
    byForm.set(formId, {
      formId,
      count: 1,
      lastError: row.lastError,
      lastAt: row.updatedAt,
    });
  }
  return [...byForm.values()];
}

/** Count rows in a status (readiness/backlog reporting). */
export async function countOutbox(db: Db, status: OutboxStatus): Promise<number> {
  const row = await db.get<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM outbox WHERE status = ${status}`,
  );
  return Number(row?.n ?? 0);
}
