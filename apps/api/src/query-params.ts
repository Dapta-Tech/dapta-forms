/**
 * Shared query-param parsers for the admin read surface (analytics +
 * submissions). A date bound accepts epoch-ms passthrough or a YYYY-MM-DD / ISO
 * string; a status narrows the submissions filter. Kept dialect- and
 * framework-agnostic so both controllers parse identically.
 */
import type { SubmissionStatus } from '@quill/db';

/** Parse a date bound: epoch-ms passthrough, or a YYYY-MM-DD / ISO string. */
export function parseBound(v: string | undefined, endOfDay: boolean): number | null {
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v);
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(t);
    if (endOfDay) d.setUTCHours(23, 59, 59, 999);
    else d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }
  return t;
}

/** Narrow a raw status query to the allowed filter (defaults to `all`). */
export function parseStatus(v: string | undefined): SubmissionStatus {
  return v === 'completed' || v === 'partial' ? v : 'all';
}

/**
 * Parse a non-negative integer query param (limit/offset). Non-numeric input
 * must resolve to `undefined` — a raw `Number('abc')` is NaN, which would reach
 * SQL as `LIMIT NaN` (empty result on SQLite, ERROR on Postgres).
 */
export function parseIntParam(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}
