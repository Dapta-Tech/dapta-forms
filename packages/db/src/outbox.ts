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
 * Concurrency (H2): due rows are ATOMICALLY CLAIMED before processing, so
 * multiple API replicas draining the same table never deliver a row twice
 * (prod runs an HPA — multiple `forms-api` pods). On Postgres the claim is
 * `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING`; on
 * SQLite (single writer) the same UPDATE ... RETURNING is atomic without locks.
 * A claim older than `staleClaimMs` is reclaimable so a crashed worker's rows
 * are not stranded. The worker's in-process `running` guard prevents overlapping
 * ticks in one process; the claim prevents overlap ACROSS processes.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from './client';

/**
 * `email` = submission lifecycle emails; `webhook`/`hubspot` = pluggable
 * submission destinations (drained by the same worker + retry machinery);
 * `booking_sync` = CRM sync of a scheduling callback (booking_event → HubSpot
 * contact update, enriched via Calendly). Adding a kind here is all the queue
 * needs — the delivery logic lives in the API (DestinationEffects /
 * BookingSyncEffects).
 */
export type OutboxKind = 'webhook' | 'email' | 'hubspot' | 'booking_sync';
/**
 * `skipped` = deliberately not performed (e.g. an email row whose tenant
 * context is unrecoverable on a transport that requires it) — recorded ONCE
 * with a reason, never retried. Distinct from `failed` (exhausted retries).
 */
export type OutboxStatus = 'pending' | 'done' | 'failed' | 'skipped';

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
  /** Which worker instance holds the claim (diagnostics). */
  claimedBy: string | null;
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
  };
}

/** Default lease before a claim is considered stale and reclaimable (5 min). */
export const DEFAULT_STALE_CLAIM_MS = 5 * 60_000;

export interface ClaimOptions {
  /** Max rows to claim in one call. */
  limit?: number;
  /** Identifies the claiming worker (host:pid). Stored for diagnostics. */
  workerId?: string;
  /** A claim older than this (ms) is reclaimable — a crashed worker's rows. */
  staleClaimMs?: number;
}

/**
 * Atomically CLAIM up to `limit` due rows and return them (H2). A row is due
 * when `status='pending'` and `next_attempt_at <= now`; it is claimable when it
 * is unclaimed OR its claim is stale (older than `staleClaimMs`). The claim sets
 * `claimed_at`/`claimed_by` in the SAME statement that selects the rows, so two
 * workers never receive the same row. `status` stays `pending` throughout (the
 * lifecycle transitions live in markOutbox*); a retry clears the claim so the
 * row can be picked up again after its backoff.
 */
export async function claimDueOutbox(
  db: Db,
  now: number,
  opts: ClaimOptions = {},
): Promise<OutboxRow[]> {
  const limit = opts.limit ?? 50;
  const workerId = opts.workerId ?? 'worker';
  const staleBefore = now - (opts.staleClaimMs ?? DEFAULT_STALE_CLAIM_MS);
  const claimable = sql`status = 'pending' AND next_attempt_at <= ${now}
      AND (claimed_at IS NULL OR claimed_at <= ${staleBefore})`;
  // Postgres: FOR UPDATE SKIP LOCKED makes concurrent claims skip locked rows.
  // SQLite: single writer serializes the UPDATE, so no row-lock clause is needed
  // (and it isn't supported). Both use UPDATE ... RETURNING for the claimed set.
  const selectDue =
    db.dialect === 'postgres'
      ? sql`SELECT id FROM outbox WHERE ${claimable} ORDER BY next_attempt_at ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED`
      : sql`SELECT id FROM outbox WHERE ${claimable} ORDER BY next_attempt_at ASC LIMIT ${limit}`;
  // Postgres must materialize the subquery via ARRAY(...): with a bare
  // IN (SELECT ... LIMIT n FOR UPDATE SKIP LOCKED) the planner may re-scan the
  // subquery per outer row and claim MORE than `limit` rows (plan-dependent),
  // defeating the two-worker split.
  const rows = await db.all<Record<string, unknown>>(
    db.dialect === 'postgres'
      ? sql`UPDATE outbox SET claimed_at = ${now}, claimed_by = ${workerId}
            WHERE id = ANY (ARRAY(${selectDue}))
            RETURNING *`
      : sql`UPDATE outbox SET claimed_at = ${now}, claimed_by = ${workerId}
            WHERE id IN (${selectDue})
            RETURNING *`,
  );
  return rows.map(mapRow);
}

/** Mark a row delivered. */
export async function markOutboxDone(db: Db, id: string, now = Date.now()): Promise<void> {
  await db.run(
    sql`UPDATE outbox SET status = 'done', updated_at = ${now}, last_error = NULL WHERE id = ${id}`,
  );
}

/**
 * Record a failed attempt and schedule the next retry with backoff. `attempts`
 * is the new (incremented) count; the row stays `pending` so the worker picks it
 * up again once `next_attempt_at` passes.
 */
export async function markOutboxRetry(
  db: Db,
  id: string,
  args: { attempts: number; error: string; now?: number },
): Promise<void> {
  const now = args.now ?? Date.now();
  const nextAt = now + backoffMs(args.attempts);
  // Clear the claim so the row is reclaimable once its backoff elapses.
  await db.run(
    sql`UPDATE outbox
        SET attempts = ${args.attempts}, next_attempt_at = ${nextAt},
            last_error = ${args.error.slice(0, 1000)}, updated_at = ${now},
            claimed_at = NULL, claimed_by = NULL
        WHERE id = ${id}`,
  );
}

/**
 * Deliberately not performed — terminal on the FIRST decision (no retry
 * schedule burned), with the reason kept as the log record.
 */
export async function markOutboxSkipped(
  db: Db,
  id: string,
  args: { reason: string; now?: number },
): Promise<void> {
  const now = args.now ?? Date.now();
  await db.run(
    sql`UPDATE outbox
        SET status = 'skipped', last_error = ${args.reason.slice(0, 1000)}, updated_at = ${now}
        WHERE id = ${id}`,
  );
}

/** Give up: the row exhausted its retries. Terminal state; kept as the log. */
export async function markOutboxFailed(
  db: Db,
  id: string,
  args: { attempts: number; error: string; now?: number },
): Promise<void> {
  const now = args.now ?? Date.now();
  await db.run(
    sql`UPDATE outbox
        SET status = 'failed', attempts = ${args.attempts},
            last_error = ${args.error.slice(0, 1000)}, updated_at = ${now}
        WHERE id = ${id}`,
  );
}

/** Inspect the queue / delivery log (tests, a future admin view). */
export async function listOutbox(
  db: Db,
  filter: { status?: OutboxStatus; kind?: OutboxKind; subjectUid?: string } = {},
): Promise<OutboxRow[]> {
  const conds = [sql`1 = 1`];
  if (filter.status) conds.push(sql`status = ${filter.status}`);
  if (filter.kind) conds.push(sql`kind = ${filter.kind}`);
  if (filter.subjectUid) conds.push(sql`subject_uid = ${filter.subjectUid}`);
  const where = sql.join(conds, sql` AND `);
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT * FROM outbox WHERE ${where} ORDER BY created_at ASC`,
  );
  return rows.map(mapRow);
}

/** Count rows in a status (readiness/backlog reporting). */
export async function countOutbox(db: Db, status: OutboxStatus): Promise<number> {
  const row = await db.get<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM outbox WHERE status = ${status}`,
  );
  return Number(row?.n ?? 0);
}
