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

/**
 * Unique sessions that viewed the form — Typeform-style unique Views. A refresh
 * in the same tab reuses the session id, so DISTINCT collapses it to one; the
 * plain `COUNT(*)` this replaced double-counted every reload (each mount emits a
 * fresh `view` row). Windowed by the event's own `created_at`.
 */
export async function uniqueViewCount(db: Db, formId: string, range?: DateRange): Promise<number> {
  const row = await db.get<{ n: number | string | null }>(
    sql`SELECT COUNT(DISTINCT session_id) AS n FROM form_event
        WHERE form_id = ${formId} AND type = 'view' ${andRange(sql`created_at`, range)}`,
  );
  return Number(row?.n ?? 0);
}

/**
 * "Starts" = unique sessions that reached the first question (`step_view` with
 * `step_index = 0`). This is the signal that fires for EVERY form: the legacy
 * `start` event is only emitted by the cover CTA, so a cover-less form never
 * produced one and reported 0 starts (and 0% completion) despite real answers.
 * `step_view` idx 0 is captured whether or not a cover exists. Windowed by
 * `created_at`.
 */
export async function startCount(db: Db, formId: string, range?: DateRange): Promise<number> {
  const row = await db.get<{ n: number | string | null }>(
    sql`SELECT COUNT(DISTINCT session_id) AS n FROM form_event
        WHERE form_id = ${formId} AND type = 'step_view' AND step_index = 0
        ${andRange(sql`created_at`, range)}`,
  );
  return Number(row?.n ?? 0);
}

/**
 * Unique sessions that viewed each step index — the drop-off funnel body.
 * DISTINCT (not COUNT(*)) so a refresh does not inflate a step's row the same
 * way it used to inflate Views.
 */
export async function stepViewCounts(
  db: Db,
  formId: string,
  range?: DateRange,
): Promise<Map<number, number>> {
  const rows = await db.all<{ step_index: number | string | null; n: number | string }>(
    sql`SELECT step_index, COUNT(DISTINCT session_id) AS n FROM form_event
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

/** Partial-only submissions in the range (windowed by `partial_at`). */
export async function partialCount(db: Db, formId: string, range?: DateRange): Promise<number> {
  const row = await db.get<{ n: number | string | null }>(
    sql`SELECT COUNT(*) AS n FROM submission
        WHERE form_id = ${formId} AND completed_at IS NULL AND partial_at IS NOT NULL
        ${andRange(sql`partial_at`, range)}`,
  );
  return Number(row?.n ?? 0);
}

/** Epoch-ms per day — the portable bucket width for the trend series. */
export const DAY_MS = 86_400_000;

/** One completed submission in range, with what the trend + timing need. */
export interface CompletedSubmission {
  /** Epoch DAY it completed (`completed_at / 86400000`) — the trend bucket. */
  day: number;
  /** ms from form OPEN to completion; null when it could not be derived. */
  durationMs: number | null;
}

/**
 * Every completed submission in the range (windowed by `completed_at` — the
 * moment it actually landed, not when the session began), carrying its
 * completion day and its open→complete duration.
 *
 * `open` is the session's first `view` event; if that event was lost
 * (top-of-funnel events are fire-and-forget) it falls back to `started_at`.
 * One query feeds three things — the Submissions total, the MEDIAN time to
 * complete, and the per-day trend — so the correlated open lookup runs once.
 *
 * The median is taken app-side: cross-dialect SQL has no portable percentile
 * (no window fns, no `percentile_cont`). The old
 * `AVG(completed_at - started_at)` was doubly wrong — `started_at` is the first
 * PERSISTED write (with no partial it equals `completed_at` → 0s), and a mean
 * skews on long-abandon outliers. Negative durations (clock skew, or a view
 * logged after completion) surface as null rather than being clamped: the row
 * still counts as a submission, it just does not pollute the median.
 */
export async function completedSubmissions(
  db: Db,
  formId: string,
  range?: DateRange,
): Promise<CompletedSubmission[]> {
  const rows = await db.all<{
    day: number | string;
    completed_at: number | string;
    started_at: number | string;
    open_at: number | string | null;
  }>(
    // 86400000 is written as a SQL literal (not a bound param) so both engines
    // do INTEGER division and bucket to a whole day. The open timestamp comes
    // back RAW (not COALESCEd in SQL) so the caller can tell "no open signal"
    // apart from "opened and completed instantly" — see below.
    sql`SELECT (s.completed_at / 86400000) AS day,
               s.completed_at AS completed_at,
               s.started_at AS started_at,
               (SELECT MIN(e.created_at) FROM form_event e
                WHERE e.form_id = s.form_id AND e.session_id = s.session_id AND e.type = 'view') AS open_at
        FROM submission s
        WHERE s.form_id = ${formId} AND s.completed_at IS NOT NULL ${andRange(sql`s.completed_at`, range)}`,
  );
  return rows.map((r) => {
    const completedAt = Number(r.completed_at);
    const startedAt = Number(r.started_at);
    const openAt = r.open_at == null ? null : Number(r.open_at);
    // Prefer the session's first `view`. If that beacon was lost, `started_at`
    // is only a usable fallback when it is STRICTLY earlier than completion —
    // when they are equal the submit itself was the first persisted write, so
    // the open time is genuinely unknown. Reporting that as 0 would resurrect
    // the exact bug this metric was rewritten to kill, so it stays null and is
    // excluded from the median rather than dragging it to zero.
    const anchor = openAt ?? (startedAt < completedAt ? startedAt : null);
    const dur = anchor == null ? null : completedAt - anchor;
    return {
      day: Number(r.day),
      durationMs: dur != null && Number.isFinite(dur) && dur >= 0 ? dur : null,
    };
  });
}

/** Per-day unique sessions that viewed the form (trend series for Views). */
export async function dailyViewSessions(
  db: Db,
  formId: string,
  range?: DateRange,
): Promise<{ day: number; n: number }[]> {
  const rows = await db.all<{ day: number | string; n: number | string }>(
    sql`SELECT (created_at / 86400000) AS day, COUNT(DISTINCT session_id) AS n
        FROM form_event
        WHERE form_id = ${formId} AND type = 'view' ${andRange(sql`created_at`, range)}
        GROUP BY (created_at / 86400000)`,
  );
  return rows.map((r) => ({ day: Number(r.day), n: Number(r.n) }));
}

/** Per-day unique sessions that reached the first question (trend for Starts). */
export async function dailyStartSessions(
  db: Db,
  formId: string,
  range?: DateRange,
): Promise<{ day: number; n: number }[]> {
  const rows = await db.all<{ day: number | string; n: number | string }>(
    sql`SELECT (created_at / 86400000) AS day, COUNT(DISTINCT session_id) AS n
        FROM form_event
        WHERE form_id = ${formId} AND type = 'step_view' AND step_index = 0
        ${andRange(sql`created_at`, range)}
        GROUP BY (created_at / 86400000)`,
  );
  return rows.map((r) => ({ day: Number(r.day), n: Number(r.n) }));
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
