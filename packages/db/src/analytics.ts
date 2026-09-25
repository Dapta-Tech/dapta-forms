/**
 * Analytics + submissions querying — the read side that powers the admin
 * dashboard (funnel + per-step drop-off) and the submissions table (paginated,
 * filtered, exportable). Everything goes through the portable `Db` port and
 * `sql` templates so the identical code runs on SQLite (clone-and-run) and
 * Postgres (prod): no dialect-specific SQL (no FILTER, no window fns) — only
 * COUNT / SUM(CASE…) / AVG(CASE…) which behave the same on both engines.
 */
import { type SQL } from 'drizzle-orm';
import { toSubmissionVisitView, type SubmissionVisitView } from '@quill/types';
import { sql, type Db } from './client';
import { parseJsonColumn, readVisitColumn } from './forms';
import type { SubmissionRow } from './forms';

/**
 * A submission as the dashboard reads it. The visit is the SAFE view: the page
 * and a "HubSpot cookie received" flag, never the cookie itself. Mapped here, at
 * the one place the admin read side turns rows into objects, so a route that
 * spreads a row into its response cannot hand the cookie out by accident.
 */
export type AdminSubmissionRow = Omit<SubmissionRow, 'visit'> & { visit: SubmissionVisitView | null };

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

/** Row orders the table offers. Every one ends on `id`, so a page boundary never shuffles ties. */
export const SUBMISSION_SORTS = ['newest', 'oldest', 'score_desc', 'score_asc'] as const;
export type SubmissionSort = (typeof SUBMISSION_SORTS)[number];

/**
 * The one filter the submissions table, its CSV export and the Summary share,
 * so the three always describe the same set of responses. `from`/`to` bound
 * `started_at`; `scoreMin`/`scoreMax` bound the score, inclusive.
 *
 * `answers` narrows by what people chose: answer key to the values accepted
 * for it. Within one key the values widen (any of them matches, and a
 * multi-select matches when any of its picks is one of them); across keys
 * they narrow (every key must match). The keys MUST already be checked
 * against the form's own choice steps by the caller: they reach SQL as bound
 * parameters, never spliced, but only a caller that knows the form can tell a
 * real question from a made-up key.
 */
export interface SubmissionFilter extends DateRange {
  status?: SubmissionStatus;
  scoreMin?: number | null;
  scoreMax?: number | null;
  answers?: Readonly<Record<string, readonly string[]>>;
}

export interface SubmissionQuery extends SubmissionFilter {
  sort?: SubmissionSort;
  limit?: number;
  offset?: number;
}

/** The status predicate for the submissions table (portable). */
function statusClause(status?: SubmissionStatus): SQL {
  if (status === 'completed') return sql`AND completed_at IS NOT NULL`;
  if (status === 'partial') return sql`AND completed_at IS NULL AND partial_at IS NOT NULL`;
  return sql``;
}

/**
 * One answer key matches any of `values`: a single stored value equal to one
 * of them, or a stored array (a multi-select) holding at least one. Both sides
 * are trimmed, the way the Summary counts a choice. The key and every value
 * are bound parameters. Postgres wraps a scalar in an array so one expansion
 * reads both shapes; SQLite's `json_each` already yields a scalar as one row.
 * The key is compared as a value, never written into a JSON path, so a key
 * with a quote or a backslash in it matches the same on both dialects.
 */
function answerMatch(db: Db, key: string, values: readonly string[]): SQL {
  const list = sql.join(
    values.map((v) => sql`${v.trim()}`),
    sql`, `,
  );
  if (db.dialect === 'postgres') {
    const field = sql`submission.data -> (${key}::text)`;
    return sql`EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(${field}) = 'array' THEN ${field} ELSE jsonb_build_array(${field}) END
      ) AS picked(v)
      WHERE TRIM(picked.v) IN (${list})
    )`;
  }
  return sql`EXISTS (
    SELECT 1 FROM json_each(submission.data) AS field
    JOIN json_each(CASE WHEN field.type = 'array' THEN field.value ELSE json_array(field.value) END) AS picked
    WHERE field.key = ${key} AND field.type NOT IN ('object', 'null')
      AND picked.type NOT IN ('object', 'null') AND TRIM(CAST(picked.value AS TEXT)) IN (${list})
  )`;
}

/**
 * A score bound as the integer column compares it: rounded inward (`>= 5.5`
 * is `>= 6`, `<= 5.5` is `<= 5`) and held to int32. Postgres binds the value
 * as an integer, so `5.5` or `1e20` as-is fails the whole query.
 */
function scoreBound(v: number | null | undefined, side: 'min' | 'max'): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const whole = side === 'min' ? Math.ceil(v) : Math.floor(v);
  return Math.min(2_147_483_647, Math.max(-2_147_483_648, whole));
}

/**
 * `WHERE` for a form's submissions under `f`: the form, the status, the
 * `started_at` window, the score bounds and every answer filter. A key with no
 * values left is no filter on that key, never "match nothing".
 */
function filterWhere(db: Db, formId: string, f: SubmissionFilter = {}): SQL {
  const parts: SQL[] = [sql`form_id = ${formId}`];
  const scoreMin = scoreBound(f.scoreMin, 'min');
  const scoreMax = scoreBound(f.scoreMax, 'max');
  if (scoreMin != null) parts.push(sql`score >= ${scoreMin}`);
  if (scoreMax != null) parts.push(sql`score <= ${scoreMax}`);
  for (const [key, values] of Object.entries(f.answers ?? {})) {
    const wanted = values.filter((v) => v.trim() !== '');
    if (wanted.length > 0) parts.push(answerMatch(db, key, wanted));
  }
  return sql`WHERE ${sql.join(parts, sql` AND `)} ${statusClause(f.status)} ${andRange(sql`started_at`, f)}`;
}

/** `ORDER BY` for a sort, newest first when absent. */
function orderBy(sort: SubmissionSort = 'newest'): SQL {
  switch (sort) {
    case 'oldest':
      return sql`ORDER BY started_at ASC, id ASC`;
    case 'score_desc':
      return sql`ORDER BY score DESC, started_at DESC, id DESC`;
    case 'score_asc':
      return sql`ORDER BY score ASC, started_at DESC, id DESC`;
    default:
      return sql`ORDER BY started_at DESC, id DESC`;
  }
}

function mapSubmission(r: Record<string, unknown>): AdminSubmissionRow {
  return {
    id: String(r.id),
    formId: String(r.form_id),
    sessionId: String(r.session_id),
    data: parseJsonColumn(r.data, {}),
    score: Number(r.score),
    startedAt: Number(r.started_at),
    completedAt: r.completed_at == null ? null : Number(r.completed_at),
    partialAt: r.partial_at == null ? null : Number(r.partial_at),
    visit: toSubmissionVisitView(readVisitColumn(r.visit)),
  };
}

/**
 * A page of a form's submissions in `q.sort` order (newest first by default),
 * with the total matching the filter (before pagination) so the UI can render
 * page counts.
 */
export async function querySubmissions(
  db: Db,
  formId: string,
  q: SubmissionQuery = {},
): Promise<{ items: AdminSubmissionRow[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(q.limit ?? 25, 1), 200);
  const offset = Math.max(q.offset ?? 0, 0);
  const where = filterWhere(db, formId, q);

  const totalRow = await db.get<{ n: number | string }>(
    sql`SELECT COUNT(*) AS n FROM submission ${where}`,
  );
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT * FROM submission ${where}
        ${orderBy(q.sort)}
        LIMIT ${limit} OFFSET ${offset}`,
  );
  return { items: rows.map(mapSubmission), total: Number(totalRow?.n ?? 0), limit, offset };
}

/**
 * Every submission for a form matching the filter, in the table's order, with
 * no pagination (used by the CSV export, which must include the full result
 * set, exactly as the table lists it).
 */
export async function allSubmissionsForExport(
  db: Db,
  formId: string,
  q: Omit<SubmissionQuery, 'limit' | 'offset'> & {
    /** Only these submissions ("Export selected"). An empty list exports nothing. */
    ids?: readonly string[];
  } = {},
): Promise<AdminSubmissionRow[]> {
  // `IN ()` is a syntax error on both dialects; no id asked for is no row.
  if (q.ids?.length === 0) return [];
  const only = q.ids ? sql`AND id IN (${bindIds(q.ids)})` : sql``;
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT * FROM submission ${filterWhere(db, formId, q)} ${only} ${orderBy(q.sort)}`,
  );
  return rows.map(mapSubmission);
}

/** A submission as the Summary reads it: the answers and the three instants, nothing else. */
export interface SummarySubmissionRow {
  id: string;
  data: unknown;
  startedAt: number;
  completedAt: number | null;
  partialAt: number | null;
}

/**
 * Every submission matching the filter, newest first (the table's order), with
 * only the columns the Summary aggregates. Unpaginated like the CSV export,
 * since every response counts, but it leaves out what the Summary never reads.
 */
export async function submissionsForSummary(
  db: Db,
  formId: string,
  q: SubmissionFilter = {},
): Promise<SummarySubmissionRow[]> {
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT id, data, started_at, completed_at, partial_at FROM submission ${filterWhere(db, formId, q)}
        ORDER BY started_at DESC, id DESC`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    data: parseJsonColumn(r.data, {}),
    startedAt: Number(r.started_at),
    completedAt: r.completed_at == null ? null : Number(r.completed_at),
    partialAt: r.partial_at == null ? null : Number(r.partial_at),
  }));
}

// --- Header filter counts (the column menus) ---------------------------------

/** What the column menus count, over every response of a form, straight from SQL. */
export interface SubmissionFacetCounts {
  total: number;
  completed: number;
  partial: number;
  /**
   * Per question key asked for: how many responses answered it (at least one
   * non-blank pick), and how many responses picked each trimmed value. A
   * response counts once per value even if a stored list repeats it.
   */
  choices: Record<string, { answered: number; values: Record<string, number> }>;
}

/**
 * The picks of the `keys` answers, one row per (response, key, trimmed pick).
 * A single stored value and a multi-select list read the same; blanks, nulls
 * and objects are no pick. The key is compared as a value (bound), never
 * written into a JSON path.
 */
function picksFrom(db: Db, formId: string, keys: readonly string[]): SQL {
  const list = sql.join(
    keys.map((k) => sql`${k}`),
    sql`, `,
  );
  if (db.dialect === 'postgres') {
    return sql`FROM submission
      CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(submission.data) = 'object' THEN submission.data ELSE '{}'::jsonb END
      ) AS field(key, value)
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(field.value) = 'array' THEN field.value ELSE jsonb_build_array(field.value) END
      ) AS picked(value)
      WHERE submission.form_id = ${formId} AND field.key IN (${list})
        AND jsonb_typeof(picked.value) IN ('string', 'number', 'boolean')
        AND TRIM(picked.value #>> '{}') <> ''`;
  }
  return sql`FROM submission
    JOIN json_each(submission.data) AS field
    JOIN json_each(CASE WHEN field.type = 'array' THEN field.value ELSE json_array(field.value) END) AS picked
    WHERE submission.form_id = ${formId} AND field.key IN (${list})
      AND picked.type NOT IN ('object', 'array', 'null')
      AND TRIM(CAST(picked.value AS TEXT)) <> ''`;
}

/**
 * The header filters' counts for a form, aggregated in the database: the
 * statuses by the table's rule, and per choice question in `keys` the
 * responses that answered it and that picked each value. Nothing but counts
 * leaves the database, however many responses there are.
 */
export async function submissionFacetCounts(
  db: Db,
  formId: string,
  keys: readonly string[],
): Promise<SubmissionFacetCounts> {
  const pick =
    db.dialect === 'postgres' ? sql`TRIM(picked.value #>> '{}')` : sql`TRIM(CAST(picked.value AS TEXT))`;
  const [totals, values, answered] = await Promise.all([
    db.get<{ total: number | string; completed: number | string | null; partial: number | string | null }>(
      sql`SELECT COUNT(*) AS total,
            SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN completed_at IS NULL AND partial_at IS NOT NULL THEN 1 ELSE 0 END) AS partial
          FROM submission WHERE form_id = ${formId}`,
    ),
    keys.length === 0
      ? Promise.resolve([])
      : db.all<{ key: string; value: string; n: number | string }>(
          sql`SELECT field.key AS key, ${pick} AS value, COUNT(DISTINCT submission.id) AS n
              ${picksFrom(db, formId, keys)}
              GROUP BY field.key, ${pick}`,
        ),
    keys.length === 0
      ? Promise.resolve([])
      : db.all<{ key: string; n: number | string }>(
          sql`SELECT field.key AS key, COUNT(DISTINCT submission.id) AS n
              ${picksFrom(db, formId, keys)}
              GROUP BY field.key`,
        ),
  ]);
  const choices: SubmissionFacetCounts['choices'] = {};
  for (const key of keys) choices[key] = { answered: 0, values: {} };
  for (const r of answered) choices[r.key]!.answered = Number(r.n);
  for (const r of values) choices[r.key]!.values[r.value] = Number(r.n);
  return {
    total: Number(totals?.total ?? 0),
    completed: Number(totals?.completed ?? 0),
    partial: Number(totals?.partial ?? 0),
    choices,
  };
}

// --- Per-question answer search (Summary tab) --------------------------------

export interface AnswerSearchQuery extends SubmissionFilter {
  /** Matched anywhere in the answer, ignoring case. Blank lists every answer. */
  query?: string;
  limit?: number;
  offset?: number;
}

/** `%needle%` for LIKE, with the needle's own `%`, `_` and `\` taken literally. */
function containsPattern(q: string): string {
  return `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * One answer key's stored text, as SQL. The key is always a bound parameter,
 * never spliced into the statement: Postgres takes it as the `->>` operand, and
 * SQLite as a JSON path (`$."key"`). A key with a quote in it cannot be written
 * as a SQLite path, so it matches nothing rather than a different key.
 */
function answerFieldText(db: Db, field: string): SQL {
  if (db.dialect === 'postgres') return sql`COALESCE(data ->> (${field}::text), '')`;
  if (field.includes('"')) return sql`''`;
  return sql`COALESCE(json_extract(data, ${`$."${field}"`}), '')`;
}

/**
 * A page of one question's answers, newest first (the table's order), with the
 * number that match before pagination. `fields` are the answer keys the
 * question stores its value under: its own key, or a name step's sub-fields,
 * which are joined with a space the way the name reads.
 *
 * The match is a case-insensitive substring. Accents are NOT folded: "gomez"
 * does not find "Gómez". Case folding is `lower()` on both dialects, which on
 * Postgres covers every letter and on SQLite only A to Z; the needle is lowered
 * in JS, so an accented capital only differs between the two when it is stored
 * in capitals.
 */
export async function searchSubmissionAnswers(
  db: Db,
  formId: string,
  fields: string[],
  q: AnswerSearchQuery = {},
): Promise<{ items: AdminSubmissionRow[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(q.limit ?? 10, 1), 50);
  const offset = Math.max(q.offset ?? 0, 0);
  if (fields.length === 0) return { items: [], total: 0, limit, offset };
  const text = sql.join(
    fields.map((f) => answerFieldText(db, f)),
    sql` || ' ' || `,
  );
  const needle = q.query?.trim() ?? '';
  const match = needle ? sql`AND lower(${text}) LIKE ${containsPattern(needle)} ESCAPE '\\'` : sql``;
  const where = sql`${filterWhere(db, formId, q)} AND TRIM(${text}) <> '' ${match}`;

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
/**
 * One submission, but only if the caller's account owns it: its answers, plus
 * the status, dates and score the response panel shows around them.
 *
 * The JOIN is the whole point: a submission id is guessable enough that reading
 * one by id alone would let any signed-in account read any other account's
 * answers. Returns null for "not yours" and for "does not exist" alike, because
 * the caller must not be able to tell those apart either.
 */
export async function getSubmissionAnswersForAccount(
  db: Db,
  accountId: string,
  submissionId: string,
): Promise<AdminSubmissionRow | null> {
  const row = await db.get<Record<string, unknown>>(
    sql`SELECT s.* FROM submission s
        JOIN form f ON f.id = s.form_id
        WHERE s.id = ${submissionId} AND f.account_id = ${accountId} LIMIT 1`,
  );
  // Postgres hands back parsed jsonb; SQLite hands back the JSON text.
  return row ? mapSubmission(row) : null;
}

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

/** The most submissions one bulk delete (or one "Export selected") may name. */
export const MAX_BULK_SUBMISSIONS = 100;

/** A list of ids as bound parameters for `IN (...)`. Never call it with an empty list. */
function bindIds(ids: readonly string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

/**
 * Delete several submissions of one form, but ONLY the ones the account owns:
 * the same scope as `deleteSubmissionForAccount`, enforced in the same SQL
 * join, so an id from another account (or another form) is never touched, and
 * one forged id in the list does not spoil the rest.
 *
 * One statement, so a failure deletes nothing rather than half the selection.
 * Returns how many rows were actually removed. That count only ever covers the
 * caller's own rows, so it says nothing about whether a foreign id exists.
 * Duplicates collapse; more than `MAX_BULK_SUBMISSIONS` distinct ids throws
 * (the controller answers 400 before it gets here).
 */
export async function deleteSubmissionsForAccount(
  db: Db,
  accountId: string,
  formId: string,
  ids: readonly string[],
): Promise<{ deleted: number }> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { deleted: 0 };
  if (unique.length > MAX_BULK_SUBMISSIONS) {
    throw new RangeError(`At most ${MAX_BULK_SUBMISSIONS} submissions per call.`);
  }
  const gone = await db.all<{ id: string }>(
    sql`DELETE FROM submission
        WHERE id IN (${bindIds(unique)})
          AND form_id = ${formId}
          AND form_id IN (SELECT id FROM form WHERE id = ${formId} AND account_id = ${accountId})
        RETURNING id`,
  );
  return { deleted: gone.length };
}

/**
 * The earliest activity of a form (epoch-ms): its first `form_event` or its
 * first submission, whichever is older (a submission can predate every event
 * when the beacons were lost). Null with nothing yet. Bounds the offset
 * segments of an unbounded analytics range, so every row falls inside one.
 */
export async function firstEventAt(db: Db, formId: string): Promise<number | null> {
  const row = await db.get<{ e: number | string | null; s: number | string | null }>(
    sql`SELECT (SELECT MIN(created_at) FROM form_event WHERE form_id = ${formId}) AS e,
               (SELECT MIN(started_at) FROM submission WHERE form_id = ${formId}) AS s`,
  );
  const candidates = [row?.e, row?.s].filter((v): v is number | string => v != null).map(Number);
  return candidates.length ? Math.min(...candidates) : null;
}
