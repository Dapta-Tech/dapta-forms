/**
 * The submissions filter as the admin routes read it from a query string: one
 * parser for the table, the CSV export, the Summary and its answer search, so
 * the four always describe the same responses.
 *
 * Answer filters arrive as one `answers` param holding JSON (`{"key":
 * ["value", …]}`), not as one param per key: step keys are free text, and a
 * key with brackets in it would be taken apart by the query-string parser.
 * Every key is checked against the form's own choice steps here, before any
 * SQL is built; a key that is not one of them (a question deleted since the
 * link was shared) is dropped. Values are only length-checked: a stored answer
 * can carry an option the form has since removed, and it must stay findable.
 * They reach SQL as bound parameters.
 */
import { BadRequestException } from '@nestjs/common';
import {
  getAccountTimezone,
  SUBMISSION_SORTS,
  type Db,
  type SubmissionFilter,
  type SubmissionSort,
} from '@quill/db';
import { isFilterableChoiceStep } from '@quill/engine';
import { resolveTimeZone } from '@quill/shared';
import type { FormConfig } from '@quill/types';
import { parseBound, parseStatus } from './query-params';

/** The query params the filter is read from. Anything but a string is ignored or refused. */
export interface FilterQuery {
  status?: unknown;
  from?: unknown;
  to?: unknown;
  scoreMin?: unknown;
  scoreMax?: unknown;
  answers?: unknown;
  sort?: unknown;
}

/** Longest `answers` param accepted, before parsing. */
const MAX_ANSWERS_LENGTH = 16_384;
/** Most values accepted for one key; a form's options stay far below it. */
const MAX_VALUES_PER_KEY = 100;
/** Longest value accepted; option values are short identifiers. */
const MAX_VALUE_LENGTH = 500;

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function bad(message: string): BadRequestException {
  return new BadRequestException({ error: 'BAD_REQUEST', message });
}

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

/**
 * A score bound as the integer column compares it: a finite number, rounded
 * inward (a score is a whole number, so `>= 5.5` is `>= 6` and `<= 5.5` is
 * `<= 5`) and held to int32, else no bound. Postgres binds it as an integer:
 * `5.5` or `1e20` sent as-is is a 500, not an empty result.
 */
export function parseScore(v: unknown, side: 'min' | 'max'): number | null {
  const s = str(v)?.trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const whole = side === 'min' ? Math.ceil(n) : Math.floor(n);
  return Math.min(INT32_MAX, Math.max(INT32_MIN, whole));
}

/**
 * `answers` narrowed to the form's choice steps. Malformed JSON, or a shape
 * that is not an object of string lists, is a 400: it can only come from a
 * hand-edited URL, and guessing what it meant could widen the result.
 */
export function parseAnswerFilters(
  v: unknown,
  config: Pick<FormConfig, 'steps'>,
): Record<string, string[]> | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v !== 'string' || v.length > MAX_ANSWERS_LENGTH)
    throw bad('answers must be a JSON object.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(v);
  } catch {
    throw bad('answers must be a JSON object.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw bad('answers must be a JSON object.');
  const filterable = new Set((config.steps ?? []).filter(isFilterableChoiceStep).map((s) => s.key));
  const out: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(raw) || raw.length > MAX_VALUES_PER_KEY) {
      throw bad(`answers.${key} must list at most ${MAX_VALUES_PER_KEY} values.`);
    }
    if (!raw.every((x) => typeof x === 'string' && x.length <= MAX_VALUE_LENGTH)) {
      throw bad(`answers.${key} must list strings.`);
    }
    if (!filterable.has(key)) continue;
    const values = [...new Set((raw as string[]).map((x) => x.trim()).filter(Boolean))];
    if (values.length > 0) out[key] = values;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The filter for one form. A date-only bound names a whole day in `zone` (the
 * workspace's), as the table reads its timestamps. The score bounds are
 * dropped when the form does not score: there is no column to filter.
 */
export function parseSubmissionFilter(
  q: FilterQuery,
  config: Pick<FormConfig, 'steps' | 'scoring'>,
  zone: string,
): SubmissionFilter {
  const scoring = config.scoring?.enabled !== false;
  return {
    status: parseStatus(str(q.status)),
    from: parseBound(str(q.from), false, zone),
    to: parseBound(str(q.to), true, zone),
    scoreMin: scoring ? parseScore(q.scoreMin, 'min') : null,
    scoreMax: scoring ? parseScore(q.scoreMax, 'max') : null,
    answers: parseAnswerFilters(q.answers, config),
  };
}

/** The row order, newest first unless another is named; a score order only when the form scores. */
export function parseSort(v: unknown, config: Pick<FormConfig, 'scoring'>): SubmissionSort {
  const sort = (SUBMISSION_SORTS as readonly string[]).includes(str(v) ?? '')
    ? (v as SubmissionSort)
    : 'newest';
  if (sort.startsWith('score') && config.scoring?.enabled === false) return 'newest';
  return sort;
}

/** The workspace's zone, the one its dates are read in; UTC when unset or unknown. */
export async function workspaceZone(
  db: Db,
  accountId: string,
  warn: (m: string) => void,
): Promise<string> {
  return resolveTimeZone(await getAccountTimezone(db, accountId), warn);
}
