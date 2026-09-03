/**
 * Shared query-param parsers for the admin read surface (analytics +
 * submissions). A date bound accepts epoch-ms passthrough or a YYYY-MM-DD / ISO
 * string; a status narrows the submissions filter. Kept dialect- and
 * framework-agnostic so both controllers parse identically.
 */
import { OUTBOX_KINDS, OUTBOX_STATUSES, type OutboxKind, type OutboxStatus, type SubmissionStatus } from '@quill/db';
import { dayBoundsInZone, isValidTimeZone } from '@quill/shared';

/**
 * Parse a date bound: epoch-ms passthrough, or a YYYY-MM-DD / ISO string. A
 * bare date names a whole calendar day in `zone` (UTC when absent): its first
 * instant, or its last with `endOfDay`.
 */
export function parseBound(v: string | undefined, endOfDay: boolean, zone: string = 'UTC'): number | null {
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v);
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const bounds = dayBoundsInZone(v, zone);
    return endOfDay ? bounds.to : bounds.from;
  }
  return t;
}

/**
 * Narrow a `?tz=` query to a zone this server can resolve. Absent → null (the
 * caller falls back to the workspace's zone); unknown → UTC, never an error,
 * so a stale link cannot 400 an analytics page.
 */
export function parseTimeZone(v: string | undefined): string | null {
  const zone = v?.trim();
  if (!zone) return null;
  return isValidTimeZone(zone) ? zone : 'UTC';
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

/**
 * Narrow a comma-separated query param to a fixed vocabulary.
 *
 * Unknown tokens are DROPPED rather than rejected: these params name outbox
 * kinds and statuses, which a future release may add to, and an older API
 * answering "webhook,carrier_pigeon" with a 400 would break a newer client over
 * a value it did not need. An absent param yields `undefined` (the caller's
 * default); a param that names ONLY unknown tokens yields an empty list, and the
 * caller is expected to answer with nothing rather than silently widen back to
 * everything — asking for a kind that does not exist must not return every kind.
 */
function parseEnumList<T extends string>(v: string | undefined, allowed: readonly T[]): T[] | undefined {
  if (v === undefined) return undefined;
  const wanted = new Set(v.split(',').map((s) => s.trim()));
  return allowed.filter((a) => wanted.has(a));
}

/** Narrow `?kind=webhook,hubspot` to real outbox kinds. */
export function parseKinds(v: string | undefined): OutboxKind[] | undefined {
  return parseEnumList(v, OUTBOX_KINDS);
}

/** Narrow `?status=done,failed` to real outbox statuses. */
export function parseOutboxStatuses(v: string | undefined): OutboxStatus[] | undefined {
  return parseEnumList(v, OUTBOX_STATUSES);
}
