/**
 * Analytics + submissions querying — the read side that powers the admin
 * dashboard (funnel + per-step drop-off) and the submissions table (paginated,
 * filtered, exportable). Everything goes through the portable `Db` port and
 * `sql` templates so the identical code runs on SQLite (clone-and-run) and
 * Postgres (prod): no dialect-specific SQL (no FILTER, no window fns) — only
 * COUNT / SUM(CASE…) / AVG(CASE…) which behave the same on both engines.
 */
import { type SQL } from 'drizzle-orm';
import { sql, type Db } from './client';
import { parseJsonColumn } from './forms';
import type { SubmissionRow } from './forms';

/** An optional epoch-ms date window applied to the query. */
export interface DateRange {
  from?: number | null;
  to?: number | null;
}

/**
 * Build the `AND col >= from AND col <= to` fragment for an optional range.
 * Each bound is independent; an empty range contributes no SQL. `col` is a
 * fixed internal identifier fragment (never user input).
 */
function andRange(col: SQL, range?: DateRange): SQL {
  const parts: SQL[] = [];
  if (range?.from != null) parts.push(sql`AND ${col} >= ${range.from}`);
  if (range?.to != null) parts.push(sql`AND ${col} <= ${range.to}`);
  return parts.length ? sql.join(parts, sql` `) : sql``;
}

// --- Raw aggregates (the primitives the service composes) --------------------

/** Count of funnel events by type within the range: `{ view: 12, start: 9, … }`. */
export async function eventTypeCounts(
  db: Db,
  formId: string,
  range?: DateRange,
): Promise<Record<string, number>> {
  const rows = await db.all<{ type: string; n: number | string }>(
    sql`SELECT type, COUNT(*) AS n FROM form_event
        WHERE form_id = ${formId} ${andRange(sql`created_at`, range)}
        GROUP BY type`,
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.type)] = Number(r.n);
  return out;
}

/** Count of `step_view` events per step index within the range. */
export async function stepViewCounts(
  db: Db,
  formId: string,
  range?: DateRange,
): Promise<Map<number, number>> {
  const rows = await db.all<{ step_index: number | string | null; n: number | string }>(
    sql`SELECT step_index, COUNT(*) AS n FROM form_event
        WHERE form_id = ${formId} AND type = 'step_view' AND step_index IS NOT NULL
        ${andRange(sql`created_at`, range)}
        GROUP BY step_index`,
  );
  const out = new Map<number, number>();
  for (const r of rows) {
    if (r.step_index == null) continue;
    out.set(Number(r.step_index), Number(r.n));
  }
  return out;
}

export interface SubmissionAggregate {
  /** Completed submissions (completed_at set). */
  completed: number;
  /** Partial-only submissions (partial_at set, completed_at null). */
  partial: number;
  /** Average ms from started_at→completed_at over completed rows (null if none). */
  avgCompletionMs: number | null;
}

/**
 * Submission counts + average completion time within the range (bounded by
 * `started_at`). SUM(CASE…) and AVG(CASE…) are portable; AVG ignores the NULLs
 * the CASE emits for non-completed rows, so it averages only completed sessions.
 */
export async function submissionAggregates(
  db: Db,
  formId: string,
  range?: DateRange,
): Promise<SubmissionAggregate> {
  const row = await db.get<{
    completed: number | string | null;
    partial: number | string | null;
    avg_ms: number | string | null;
  }>(
    sql`SELECT
          SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN completed_at IS NULL AND partial_at IS NOT NULL THEN 1 ELSE 0 END) AS partial,
          AVG(CASE WHEN completed_at IS NOT NULL THEN (completed_at - started_at) ELSE NULL END) AS avg_ms
        FROM submission
        WHERE form_id = ${formId} ${andRange(sql`started_at`, range)}`,
  );
  return {
    completed: Number(row?.completed ?? 0),
    partial: Number(row?.partial ?? 0),
    avgCompletionMs: row?.avg_ms == null ? null : Number(row.avg_ms),
  };
}

// --- Submissions table (paginated + filtered) --------------------------------

export type SubmissionStatus = 'all' | 'completed' | 'partial';

export interface SubmissionQuery extends DateRange {
  status?: SubmissionStatus;
  limit?: number;
  offset?: number;
}

/** The status predicate for the submissions table (portable). */
function statusClause(status?: SubmissionStatus): SQL {
  if (status === 'completed') return sql`AND completed_at IS NOT NULL`;
  if (status === 'partial') return sql`AND completed_at IS NULL AND partial_at IS NOT NULL`;
  return sql``;
}

function mapSubmission(r: Record<string, unknown>): SubmissionRow {
  return {
    id: String(r.id),
    formId: String(r.form_id),
    sessionId: String(r.session_id),
    data: parseJsonColumn(r.data, {}),
    score: Number(r.score),
    startedAt: Number(r.started_at),
    completedAt: r.completed_at == null ? null : Number(r.completed_at),
    partialAt: r.partial_at == null ? null : Number(r.partial_at),
  };
}

/**
 * A page of a form's submissions, newest first, with the total matching the
 * filter (before pagination) so the UI can render page counts. `status` narrows
 * to complete/partial; `from`/`to` bound `started_at`.
 */
export async function querySubmissions(
  db: Db,
  formId: string,
  q: SubmissionQuery = {},
): Promise<{ items: SubmissionRow[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(q.limit ?? 25, 1), 200);
  const offset = Math.max(q.offset ?? 0, 0);
  const where = sql`WHERE form_id = ${formId} ${statusClause(q.status)} ${andRange(sql`started_at`, q)}`;

  const totalRow = await db.get<{ n: number | string }>(
    sql`SELECT COUNT(*) AS n FROM submission ${where}`,
  );
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT * FROM submission ${where}
        ORDER BY started_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
  );
  return { items: rows.map(mapSubmission), total: Number(totalRow?.n ?? 0), limit, offset };
}

/**
 * Every submission for a form matching the filter, newest first — no pagination
 * (used by the CSV export, which must include the full result set). Bounded by
 * the same status/date filter as the table.
 */
export async function allSubmissionsForExport(
  db: Db,
  formId: string,
  q: Omit<SubmissionQuery, 'limit' | 'offset'> = {},
): Promise<SubmissionRow[]> {
  const where = sql`WHERE form_id = ${formId} ${statusClause(q.status)} ${andRange(sql`started_at`, q)}`;
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT * FROM submission ${where} ORDER BY started_at DESC`,
  );
  return rows.map(mapSubmission);
}

// --- Account-scoped submission delete ----------------------------------------

/**
 * Outcome of an account-scoped submission delete:
 *  - `deleted`   — the row belonged to the account and was removed.
 *  - `absent`    — no such submission anywhere (already-deleted or never
 *                  existed) → the caller treats this as an idempotent success.
 *  - `forbidden` — the row exists but belongs to ANOTHER account → the caller
 *                  surfaces a 404 (mirrors GET, and never mutates the row).
 */
export type DeleteSubmissionResult = 'deleted' | 'absent' | 'forbidden';

/**
 * Delete a submission, but ONLY if it belongs to a form the account owns. The
 * account scope is enforced in SQL via the form join, so a forged id can never
 * touch another tenant's data. Cross-account and same-account-already-deleted
 * are distinguished (a second existence probe) so the HTTP layer can idempotent-
 * 204 a genuine already-gone row while 404-ing a cross-account id.
 */
export async function deleteSubmissionForAccount(
  db: Db,
  accountId: string,
  submissionId: string,
): Promise<DeleteSubmissionResult> {
  const owned = await db.get<{ id: string }>(
    sql`SELECT s.id FROM submission s
        JOIN form f ON f.id = s.form_id
        WHERE s.id = ${submissionId} AND f.account_id = ${accountId} LIMIT 1`,
  );
  if (owned) {
    await db.run(sql`DELETE FROM submission WHERE id = ${submissionId}`);
    return 'deleted';
  }
  // Not owned: does it exist under a different account, or is it simply gone?
  const exists = await db.get<{ id: string }>(
    sql`SELECT id FROM submission WHERE id = ${submissionId} LIMIT 1`,
  );
  return exists ? 'forbidden' : 'absent';
}
