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
 * How to name the CALENDAR DAY an epoch-ms instant falls on. Absent = UTC
 * days, byte-for-byte the SQL this module always ran. Otherwise the UTC
 * offset of the workspace's zone across the queried window, as segments that
 * start where the offset changes (`utcOffsetSegments` in @quill/shared): one
 * for a fixed-offset zone, two or three across a DST year. The day expression
 * becomes `(col + offset) / 86400000` with the offset picked by a CASE over
 * the segment starts, so bucketing stays inside SQL (COUNT DISTINCT needs it
 * there) and stays dialect-neutral.
 */
export interface DayBucketing {
  segments: Array<{ from: number; offsetMs: number }>;
}

/** The whole-day index of `col` under `bucketing` (UTC days when absent). */
function localDayExpr(col: SQL, bucketing?: DayBucketing): SQL {
  const segments = bucketing?.segments ?? [];
  // 86400000 is a SQL literal (not a bound param) so both engines do INTEGER
  // division and bucket to a whole day.
  if (segments.length === 0) return sql`(${col} / 86400000)`;
  // Offsets and boundaries are inlined as INTEGER literals, like the day
  // length: a bound number reaches SQLite as a REAL and the division stops
  // truncating, which splits one day into fractional buckets. They are
  // computed integers (whole minutes of offset, epoch-ms instants), never
  // caller input, so inlining is safe.
  const int = (n: number) => sql.raw(String(Math.trunc(n)));
  if (segments.length === 1) return sql`((${col} + ${int(segments[0]!.offsetMs)}) / 86400000)`;
  const branches = segments
    .slice(0, -1)
    .map((seg, i) => sql`WHEN ${col} < ${int(segments[i + 1]!.from)} THEN ${int(seg.offsetMs)}`);
  const last = segments[segments.length - 1]!;
  return sql`((${col} + (CASE ${sql.join(branches, sql` `)} ELSE ${int(last.offsetMs)} END)) / 86400000)`;
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

/** The `HAVING` mirror of {@link andRange}, for a range applied to an aggregate
 *  (e.g. `MIN(created_at)`) rather than a plain column. */
function havingRange(col: SQL, range?: DateRange): SQL {
  const parts: SQL[] = [];
  if (range?.from != null) parts.push(sql`${col} >= ${range.from}`);
  if (range?.to != null) parts.push(sql`${col} <= ${range.to}`);
  return parts.length ? sql`HAVING ${sql.join(parts, sql` AND `)}` : sql``;
}

/**
 * The session ids whose COHORT ANCHOR — the session's earliest `form_event`
 * row, of any type — falls within `range` (V5-D1).
 *
 * Every funnel metric used to window by ITS OWN timestamp (views by their
 * `created_at`, starts by theirs, submissions by `completed_at`): correct in
 * isolation, but it let a session contribute a completion to a window without
 * its matching start, so `submissions / starts` could read over 100%, and a
 * session straddling a UTC day split across two trend buckets. Anchoring every
 * metric to when the session FIRST showed up makes them all describe the same
 * population — a session belongs to exactly one window, in every metric, by
 * construction.
 */
function cohortSessionIds(formId: string, range?: DateRange): SQL {
  return sql`(
    SELECT session_id FROM form_event
    WHERE form_id = ${formId}
    GROUP BY session_id
    ${havingRange(sql`MIN(created_at)`, range)}
  )`;
}

// --- Raw aggregates (the primitives the service composes) --------------------

/**
 * Unique sessions that viewed the form — Typeform-style unique Views. A refresh
 * in the same tab reuses the session id, so DISTINCT collapses it to one; the
 * plain `COUNT(*)` this replaced double-counted every reload (each mount emits a
 * fresh `view` row). Windowed by the session's cohort anchor (V5-D1), not the
 * `view` event's own timestamp — see {@link cohortSessionIds}.
 */
export async function uniqueViewCount(db: Db, formId: string, range?: DateRange): Promise<number> {
  const row = await db.get<{ n: number | string | null }>(
    sql`SELECT COUNT(DISTINCT session_id) AS n FROM form_event
        WHERE form_id = ${formId} AND type = 'view'
        AND session_id IN ${cohortSessionIds(formId, range)}`,
  );
  return Number(row?.n ?? 0);
}

/**
 * "Starts" = unique sessions that STARTED ANSWERING: they clicked the cover CTA
 * (`start`) or completed at least one question (`step_complete`). The previous
 * definition — `step_view` with `step_index = 0` — degenerated on forms without
 * a cover (and on the vertical layout, where the first question is visible on
 * load): the first question renders on mount, so Starts ≈ Views and the metric
 * carried no signal. Counting explicit intent instead fixes that for BOTH kinds
 * of form, retroactively: historical sessions already carry `step_complete`
 * rows, and cover sessions already carry `start`, so no cutover or backfill is
 * needed. A session that only looked at question 1 and left now counts as a
 * View (and as drop-off on that question), not as a Start. Windowed by the
 * session's cohort anchor (V5-D1) — see {@link cohortSessionIds}.
 */
export async function startCount(db: Db, formId: string, range?: DateRange): Promise<number> {
  const row = await db.get<{ n: number | string | null }>(
    sql`SELECT COUNT(DISTINCT session_id) AS n FROM form_event
        WHERE form_id = ${formId} AND type IN ('start', 'step_complete')
        AND session_id IN ${cohortSessionIds(formId, range)}`,
  );
  return Number(row?.n ?? 0);
}

/**
 * Unique sessions that viewed each step index — the drop-off funnel body.
 * DISTINCT (not COUNT(*)) so a refresh does not inflate a step's row the same
 * way it used to inflate Views.
 */
/**
 * Unique-session step views, keyed BOTH ways (V5-D3):
 *  - `byKey`: grouped by the step's authored `step_key` — stable regardless of
 *    where the step sat in a given session's visible-step order. This is the
 *    authoritative source once a form has step_key-tagged traffic.
 *  - `byIndex`: the old positional grouping, from rows recorded BEFORE
 *    step_key existed (step_key IS NULL). `step_index` is a session-relative
 *    position under show/hide/goto logic, so mapping it onto the form's
 *    authored step order can attribute a view to the wrong question — this is
 *    kept only as a fallback for historical data, not a fix in itself.
 */
export interface StepViewCounts {
  byKey: Map<string, number>;
  byIndex: Map<number, number>;
}

export async function stepViewCounts(
  db: Db,
  formId: string,
  range?: DateRange,
): Promise<StepViewCounts> {
  return stepEventCounts(db, formId, 'step_view', range);
}

/**
 * Unique-session step COMPLETIONS ("answered"), same dual keying as
 * {@link stepViewCounts}. This is the honest funnel body for the VERTICAL
 * layout: every question is on one page, so "viewed" fires for most of the
 * form the moment it loads and the per-step drop-off flattens into Views.
 * What actually varies per question there is whether it got answered.
 */
export async function stepCompleteCounts(
  db: Db,
  formId: string,
  range?: DateRange,
): Promise<StepViewCounts> {
  return stepEventCounts(db, formId, 'step_complete', range);
}

async function stepEventCounts(
  db: Db,
  formId: string,
  type: 'step_view' | 'step_complete',
  range?: DateRange,
): Promise<StepViewCounts> {
  const [keyRows, indexRows] = await Promise.all([
    db.all<{ step_key: string; n: number | string }>(
      sql`SELECT step_key, COUNT(DISTINCT session_id) AS n FROM form_event
          WHERE form_id = ${formId} AND type = ${type} AND step_key IS NOT NULL
          AND session_id IN ${cohortSessionIds(formId, range)}
          GROUP BY step_key`,
    ),
    db.all<{ step_index: number | string | null; n: number | string }>(
      sql`SELECT step_index, COUNT(DISTINCT session_id) AS n FROM form_event
          WHERE form_id = ${formId} AND type = ${type} AND step_key IS NULL
          AND step_index IS NOT NULL
          AND session_id IN ${cohortSessionIds(formId, range)}
          GROUP BY step_index`,
    ),
  ]);
  const byKey = new Map<string, number>();
  for (const r of keyRows) byKey.set(r.step_key, Number(r.n));
  const byIndex = new Map<number, number>();
  for (const r of indexRows) {
    if (r.step_index == null) continue;
    byIndex.set(Number(r.step_index), Number(r.n));
  }
  return { byKey, byIndex };
}

/**
 * A submission's cohort anchor: the session's earliest `form_event` row, or —
 * for the rare session with none at all (every top-of-funnel beacon lost) —
 * its `started_at`. Shared by every submission-table query that windows by
 * cohort (V5-D1) rather than by when the submission itself last changed.
 */
function submissionAnchor(): SQL {
  return sql`COALESCE(
    (SELECT MIN(fe.created_at) FROM form_event fe
     WHERE fe.form_id = s.form_id AND fe.session_id = s.session_id),
    s.started_at
  )`;
}

/** Partial-only submissions in the range (windowed by the session's cohort
 *  anchor, V5-D1 — not `partial_at`, so a partial counts with its start). */
export async function partialCount(db: Db, formId: string, range?: DateRange): Promise<number> {
  const row = await db.get<{ n: number | string | null }>(
    sql`SELECT COUNT(*) AS n FROM submission s
        WHERE s.form_id = ${formId} AND s.completed_at IS NULL AND s.partial_at IS NOT NULL
        ${andRange(submissionAnchor(), range)}`,
  );
  return Number(row?.n ?? 0);
}

/**
 * Unique sessions that booked a meeting (scheduler step / booking outcome) —
 * DISTINCT session_id so a provider double-callback can never count twice.
 * Windowed by the session's cohort anchor like every other funnel metric
 * (V5-D1): the session's earliest `form_event`, falling back to the booking's
 * own `created_at` for a session whose top-of-funnel beacons were all lost.
 */
export async function bookingCount(db: Db, formId: string, range?: DateRange): Promise<number> {
  const anchor = sql`COALESCE(
    (SELECT MIN(fe.created_at) FROM form_event fe
     WHERE fe.form_id = b.form_id AND fe.session_id = b.session_id),
    b.created_at
  )`;
  const row = await db.get<{ n: number | string | null }>(
    sql`SELECT COUNT(DISTINCT b.session_id) AS n FROM booking_event b
        WHERE b.form_id = ${formId}
        ${andRange(anchor, range)}`,
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
 * Every completed submission in the range (windowed by the session's cohort
 * anchor, V5-D1 — not `completed_at`, so a completion is never counted without
 * its matching start), carrying the anchor's day (its trend bucket, so a
 * session belongs to the SAME day in every metric) and its open→complete
 * duration.
 *
 * `open` (for the duration only — unrelated to the cohort anchor above) is the
 * session's first `view` event; if that event was lost (top-of-funnel events
 * are fire-and-forget) it falls back to `started_at`. One query feeds three
 * things — the Submissions total, the MEDIAN time to complete, and the per-day
 * trend — so both correlated lookups run once.
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
  bucketing?: DayBucketing,
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
    sql`SELECT ${localDayExpr(submissionAnchor(), bucketing)} AS day,
               s.completed_at AS completed_at,
               s.started_at AS started_at,
               (SELECT MIN(e.created_at) FROM form_event e
                WHERE e.form_id = s.form_id AND e.session_id = s.session_id AND e.type = 'view') AS open_at
        FROM submission s
        WHERE s.form_id = ${formId} AND s.completed_at IS NOT NULL ${andRange(submissionAnchor(), range)}`,
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

/**
 * The per-session cohort-anchor day, restricted to sessions that also have at
 * least one row matching `eventFilter` — the shared shape behind both
 * daily-trend primitives below. Bucketing by the ANCHOR's day (not the event's
 * own day, V5-D1) means a session that straddles a UTC day boundary still
 * lands in exactly one bucket, in every metric, instead of splitting its views
 * into one day and its start into another.
 */
function dailySessionsQuery(formId: string, eventFilter: SQL, range?: DateRange, bucketing?: DayBucketing): SQL {
  const day = localDayExpr(sql`a.anchor`, bucketing);
  return sql`SELECT ${day} AS day, COUNT(DISTINCT a.session_id) AS n
      FROM (
        SELECT session_id, MIN(created_at) AS anchor FROM form_event
        WHERE form_id = ${formId} GROUP BY session_id
      ) a
      WHERE a.session_id IN (
        SELECT session_id FROM form_event WHERE form_id = ${formId} AND ${eventFilter}
      )
      ${andRange(sql`a.anchor`, range)}
      GROUP BY ${day}`;
}

/** Per-day unique sessions that viewed the form (trend series for Views). */
export async function dailyViewSessions(
  db: Db,
  formId: string,
  range?: DateRange,
  bucketing?: DayBucketing,
): Promise<{ day: number; n: number }[]> {
  const rows = await db.all<{ day: number | string; n: number | string }>(
    dailySessionsQuery(formId, sql`type = 'view'`, range, bucketing),
  );
  return rows.map((r) => ({ day: Number(r.day), n: Number(r.n) }));
}

/** Per-day unique sessions that started answering (trend for Starts — same
 *  `start`/`step_complete` definition as {@link startCount}). */
export async function dailyStartSessions(
  db: Db,
  formId: string,
  range?: DateRange,
  bucketing?: DayBucketing,
): Promise<{ day: number; n: number }[]> {
  const rows = await db.all<{ day: number | string; n: number | string }>(
    dailySessionsQuery(formId, sql`type IN ('start', 'step_complete')`, range, bucketing),
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
        ORDER BY started_at DESC, id DESC
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
    sql`SELECT * FROM submission ${where} ORDER BY started_at DESC, id DESC`,
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

/** The earliest `form_event` of a form (epoch-ms), or null with no events yet. */
export async function firstEventAt(db: Db, formId: string): Promise<number | null> {
  const row = await db.get<{ t: number | string | null }>(
    sql`SELECT MIN(created_at) AS t FROM form_event WHERE form_id = ${formId}`,
  );
  return row?.t == null ? null : Number(row.t);
}
