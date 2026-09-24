/**
 * The header filters as they live in the address bar, shared by the server
 * pages (which read them and ask the API) and the client controls (which
 * rewrite them). Plain module, no `'use client'`, for the reason given in
 * `viewer-params.ts`.
 *
 * In the page's URL, readable and shareable:
 *
 *   ?status=completed            the old status buttons' param, still read;
 *                                both boxes checked writes it twice
 *   ?f.<questionKey>=<value>     once per checked option
 *   ?range=today|7d|30d          a rolling window, kept rolling in a shared link
 *   ?from=YYYY-MM-DD&to=…        a custom window, in the workspace's zone
 *   ?scoreMin=…&scoreMax=…       inclusive
 *   ?sort=oldest|score_desc|score_asc   newest is the default and never written
 *
 * The API gets the same filter with the answers packed into one JSON param
 * (see `apiFilterQuery`), and the window as dates.
 */
import { DAY_MS, isoDateInZone } from '@quill/shared';

export const SORTS = ['newest', 'oldest', 'score_desc', 'score_asc'] as const;
export type SortKey = (typeof SORTS)[number];
export const RANGE_PRESETS = ['today', '7d', '30d'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export const STATUSES = ['completed', 'partial'] as const;
export type StatusKey = (typeof STATUSES)[number];

export interface ViewFilter {
  /** The statuses checked; none is no filter, like both. */
  statuses: StatusKey[];
  /** Question key to the option values checked for it. Only the form's choice questions. */
  answers: Record<string, string[]>;
  preset: RangePreset | null;
  /** A custom window (`YYYY-MM-DD`), when there is no preset. */
  from: string | null;
  to: string | null;
  scoreMin: number | null;
  scoreMax: number | null;
  sort: SortKey;
}

export const EMPTY_FILTER: ViewFilter = {
  statuses: [],
  answers: {},
  preset: null,
  from: null,
  to: null,
  scoreMin: null,
  scoreMax: null,
  sort: 'newest',
};

/** The prefix of an answer filter's param: `f.<questionKey>`. */
export const ANSWER_PREFIX = 'f.';
/** Every param the filter owns, besides the `f.` ones. */
const FILTER_PARAMS = ['status', 'range', 'from', 'to', 'scoreMin', 'scoreMax', 'sort'] as const;
/** What a filter change resets: the page, and the response open on it. */
const RESET_PARAMS = ['offset', 'response'] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The API's limits on the answer filters (`apps/api/src/submission-filter.ts`),
 * which answers past them with a 400. The page keeps within them, dropping
 * what does not fit, so a hand-made URL narrows less instead of breaking.
 */
const MAX_VALUE_LENGTH = 500;
const MAX_VALUES_PER_KEY = 100;
const MAX_ANSWERS_JSON = 16_384;

/** What the form allows filtering by: its choice questions, and the score when it scores. */
export interface FilterScope {
  choiceKeys: ReadonlySet<string>;
  scoring: boolean;
}

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function all(params: RawParams, name: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(name);
  const v = params[name];
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

function first(params: RawParams, name: string): string | undefined {
  return all(params, name)[0];
}

function names(params: RawParams): string[] {
  return params instanceof URLSearchParams ? [...new Set(params.keys())] : Object.keys(params);
}

function num(v: string | undefined): number | null {
  if (v == null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoDate(v: string | undefined): string | null {
  return v && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v)) ? v : null;
}

/**
 * The filter in `params`, narrowed to what this form can filter: an answer
 * key that is not one of its choice questions (deleted since the link was
 * shared) is dropped, and so are the score bounds and score sorts on a form
 * that does not score. The API applies the same rule, so the chips and the
 * rows always agree.
 */
export function parseViewFilter(params: RawParams, scope: FilterScope): ViewFilter {
  const status = all(params, 'status');
  const answers: Record<string, string[]> = {};
  for (const name of names(params)) {
    if (!name.startsWith(ANSWER_PREFIX)) continue;
    const key = name.slice(ANSWER_PREFIX.length);
    if (!scope.choiceKeys.has(key)) continue;
    const values = [
      ...new Set(
        all(params, name)
          .map((v) => v.trim())
          .filter((v) => v !== '' && v.length <= MAX_VALUE_LENGTH),
      ),
    ].slice(0, MAX_VALUES_PER_KEY);
    if (values.length > 0) answers[key] = values;
  }
  fitAnswers(answers);
  const range = first(params, 'range');
  const preset = (RANGE_PRESETS as readonly string[]).includes(range ?? '')
    ? (range as RangePreset)
    : null;
  const sort = first(params, 'sort');
  const parsedSort = (SORTS as readonly string[]).includes(sort ?? '')
    ? (sort as SortKey)
    : 'newest';
  let scoreMin = scope.scoring ? num(first(params, 'scoreMin')) : null;
  let scoreMax = scope.scoring ? num(first(params, 'scoreMax')) : null;
  // A reversed pair is read the way it was meant.
  if (scoreMin != null && scoreMax != null && scoreMin > scoreMax)
    [scoreMin, scoreMax] = [scoreMax, scoreMin];
  let from = preset ? null : isoDate(first(params, 'from'));
  let to = preset ? null : isoDate(first(params, 'to'));
  if (from && to && from > to) [from, to] = [to, from];
  return {
    statuses: STATUSES.filter((st) => status.includes(st)),
    answers,
    preset,
    from,
    to,
    scoreMin,
    scoreMax,
    sort: parsedSort.startsWith('score') && !scope.scoring ? 'newest' : parsedSort,
  };
}

/** Drops the last values (then keys) until `answers` fits the API's JSON limit. */
function fitAnswers(answers: Record<string, string[]>): void {
  while (JSON.stringify(answers).length > MAX_ANSWERS_JSON) {
    const keys = Object.keys(answers);
    const last = keys[keys.length - 1]!;
    answers[last]!.pop();
    if (answers[last]!.length === 0) delete answers[last];
  }
}

export function hasDateFilter(f: ViewFilter): boolean {
  return f.preset != null || f.from != null || f.to != null;
}

export function hasScoreFilter(f: ViewFilter): boolean {
  return f.scoreMin != null || f.scoreMax != null;
}

/** Whether any filter narrows the rows (the sort alone does not). */
export function isFiltered(f: ViewFilter): boolean {
  return (
    f.statuses.length > 0 ||
    Object.keys(f.answers).length > 0 ||
    hasDateFilter(f) ||
    hasScoreFilter(f)
  );
}

/** Whether anything differs from the plain view: a filter, or a sort that is not newest first. */
export function isCustomized(f: ViewFilter): boolean {
  return isFiltered(f) || f.sort !== 'newest';
}

/** The filter as page-URL params, in one fixed order (it also keys the table). */
export function filterParams(f: ViewFilter): URLSearchParams {
  const q = new URLSearchParams();
  for (const st of f.statuses) q.append('status', st);
  for (const key of Object.keys(f.answers).sort()) {
    for (const v of f.answers[key]!) q.append(`${ANSWER_PREFIX}${key}`, v);
  }
  if (f.preset) q.set('range', f.preset);
  if (f.from) q.set('from', f.from);
  if (f.to) q.set('to', f.to);
  if (f.scoreMin != null) q.set('scoreMin', String(f.scoreMin));
  if (f.scoreMax != null) q.set('scoreMax', String(f.scoreMax));
  if (f.sort !== 'newest') q.set('sort', f.sort);
  return q;
}

/**
 * `search` (the page's current query) with its filter replaced by `f`. The
 * view's other state (the sheet, the page size) stays; the page offset and
 * the open response go, since the rows they pointed at are another set now.
 */
export function withFilter(search: URLSearchParams | string, f: ViewFilter): URLSearchParams {
  const q = new URLSearchParams(search);
  for (const name of [...q.keys()]) {
    if (name.startsWith(ANSWER_PREFIX)) q.delete(name);
  }
  for (const name of [...FILTER_PARAMS, ...RESET_PARAMS]) q.delete(name);
  for (const [name, value] of filterParams(f)) q.append(name, value);
  return q;
}

/** `?query`, or '' when there is none. */
export function queryString(q: URLSearchParams): string {
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** An ISO date `days` before `iso` (whole calendar days, no zone involved). */
function isoMinusDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The window as calendar days in `timeZone`: a preset counts back from today
 * there ("7 days" is today and the six before it), a custom window is as
 * written. Null bounds are open.
 */
export function dateWindow(
  f: ViewFilter,
  timeZone: string,
  now: number = Date.now(),
): { from: string | null; to: string | null } {
  if (!f.preset) return { from: f.from, to: f.to };
  const today = isoDateInZone(now, timeZone);
  const back = f.preset === 'today' ? 0 : f.preset === '7d' ? 6 : 29;
  return { from: isoMinusDays(today, back), to: today };
}

/**
 * The filter as the API reads it (`apps/api/src/submission-filter.ts`): the
 * answers packed into one JSON param, the window as dates the API reads in the
 * workspace's zone.
 */
export function apiFilterQuery(
  f: ViewFilter,
  timeZone: string,
  now: number = Date.now(),
): Record<string, string | undefined> {
  const window = dateWindow(f, timeZone, now);
  return {
    // Both statuses are every response: only one of them narrows.
    status: f.statuses.length === 1 ? f.statuses[0] : undefined,
    from: window.from ?? undefined,
    to: window.to ?? undefined,
    scoreMin: f.scoreMin == null ? undefined : String(f.scoreMin),
    scoreMax: f.scoreMax == null ? undefined : String(f.scoreMax),
    answers: Object.keys(f.answers).length > 0 ? JSON.stringify(f.answers) : undefined,
    sort: f.sort === 'newest' ? undefined : f.sort,
  };
}

/** The API query as a query string (for the CSV link, which forwards it untouched). */
export function apiQueryString(query: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v != null && v !== '') q.set(k, v);
  return queryString(q);
}
