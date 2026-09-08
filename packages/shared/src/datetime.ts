/**
 * Timezone-aware date math on top of `Intl` alone (this repo carries no date
 * library). Isomorphic: the same code names calendar days on the server (day
 * buckets, CSV export) and formats timestamps in the browser.
 *
 * Every function tolerates an unknown zone by resolving it as UTC (with an
 * optional warning), never by throwing: a mistyped zone in a setting must not
 * take a page or a query down with it.
 */

export const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** Whether this runtime's ICU data knows `zone` as an IANA name. */
export function isValidTimeZone(zone: string | null | undefined): boolean {
  const name = zone?.trim();
  if (!name) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** `zone` when the runtime knows it, else `'UTC'` (warning the caller). */
export function resolveTimeZone(
  zone: string | null | undefined,
  warn?: (message: string) => void,
): string {
  const name = zone?.trim();
  if (!name) return "UTC";
  if (isValidTimeZone(name)) return name;
  warn?.(`timezone: unknown zone ${JSON.stringify(name)}, using UTC instead`);
  return "UTC";
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** A cached parts formatter for one zone; `hourCycle: 'h23'` keeps midnight as 0. */
function partsFormatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, f);
  }
  return f;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall-clock reading of `epochMs` in a (resolved) zone. */
function wallClock(epochMs: number, zone: string): WallClock {
  // Read BY PART TYPE, never by parsing a formatted string: the order of a
  // formatted date depends on ICU data, the part types do not.
  const parts = partsFormatter(zone).formatToParts(new Date(epochMs));
  const at = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  const hour = at("hour");
  return {
    year: at("year"),
    month: at("month"),
    day: at("day"),
    // Some ICU builds print midnight as 24 even under h23.
    hour: hour === 24 ? 0 : hour,
    minute: at("minute"),
    second: at("second"),
  };
}

/** The zone's UTC offset at `epochMs`, in ms (negative west of Greenwich). */
export function tzOffsetMs(epochMs: number, zone: string): number {
  const name = resolveTimeZone(zone);
  if (name === "UTC") return 0;
  const w = wallClock(epochMs, name);
  const asUtc = Date.UTC(
    w.year,
    w.month - 1,
    w.day,
    w.hour,
    w.minute,
    w.second,
  );
  // Offsets are whole minutes; rounding drops the sub-second part of `epochMs`.
  return Math.round((asUtc - epochMs) / MINUTE_MS) * MINUTE_MS;
}

/**
 * The calendar day `epochMs` falls on in `zone`, as a day index (days since
 * the epoch of that LOCAL day). The JS twin of the SQL bucketing expression
 * `(col + offset) / 86400000`, so trends built here and buckets built there
 * agree by construction.
 */
export function localDayIndex(epochMs: number, zone: string): number {
  return Math.floor((epochMs + tzOffsetMs(epochMs, zone)) / DAY_MS);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `YYYY-MM-DD` of the calendar day `epochMs` falls on in `zone`. */
export function isoDateInZone(epochMs: number, zone: string): string {
  const w = wallClock(epochMs, resolveTimeZone(zone));
  return `${String(w.year).padStart(4, "0")}-${pad2(w.month)}-${pad2(w.day)}`;
}

function parseIso(isoDate: string): {
  year: number;
  month: number;
  day: number;
} {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m)
    throw new Error(`expected YYYY-MM-DD, got ${JSON.stringify(isoDate)}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/**
 * The instant local midnight of `isoDate` happens in `zone`. Two passes over
 * the offset (the offset AT the guessed instant may differ from the offset at
 * the naive one around a DST change). When midnight itself does not exist
 * (the clocks jump from 23:59 to 01:00), the first instant of that local day
 * is returned instead.
 */
export function zonedMidnightMs(isoDate: string, zone: string): number {
  const name = resolveTimeZone(zone);
  const { year, month, day } = parseIso(isoDate);
  const naive = Date.UTC(year, month - 1, day);
  if (name === "UTC") return naive;
  let candidate = naive - tzOffsetMs(naive, name);
  const second = tzOffsetMs(candidate, name);
  candidate = naive - second;
  const target = `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
  const w = wallClock(candidate, name);
  if (
    isoDateInZone(candidate, name) === target &&
    w.hour === 0 &&
    w.minute === 0
  )
    return candidate;
  // A skipped midnight: walk forward minute by minute (a DST gap is an hour or
  // two) to the first instant that reads as the wanted day.
  let t = candidate;
  for (let i = 0; i < 3 * 60; i++) {
    if (isoDateInZone(t, name) === target) return t;
    t += MINUTE_MS;
  }
  return candidate;
}

function addDaysIso(isoDate: string, days: number): string {
  const { year, month, day } = parseIso(isoDate);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

/** The epoch-ms window `[from, to]` of the whole local day `isoDate` in `zone`. */
export function dayBoundsInZone(
  isoDate: string,
  zone: string,
): { from: number; to: number } {
  const from = zonedMidnightMs(isoDate, zone);
  const next = zonedMidnightMs(addDaysIso(isoDate, 1), zone);
  return { from, to: next - 1 };
}

/** One stretch of constant UTC offset; `from` is inclusive, the next segment ends it. */
export interface OffsetSegment {
  from: number;
  offsetMs: number;
}

/**
 * The UTC offset of `zone` across `[from, to]`, as segments that start where
 * the offset changes (to the minute). Walks in daily steps and bisects each
 * change, so a year of a DST zone is two or three segments and a fixed-offset
 * zone (or UTC) is always exactly one. This is what lets SQL bucket days in
 * a zone with a CASE over a handful of boundaries instead of per-row math.
 */
export function utcOffsetSegments(
  from: number,
  to: number,
  zone: string,
): OffsetSegment[] {
  const name = resolveTimeZone(zone);
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const off = (t: number) => tzOffsetMs(t, name);
  const segments: OffsetSegment[] = [{ from: start, offsetMs: off(start) }];
  if (name === "UTC") return segments;
  let t = start;
  while (t < end) {
    const next = Math.min(t + DAY_MS, end);
    const before = off(t);
    if (off(next) !== before) {
      // Bisect on the minute grid for the first minute with the new offset.
      let lo = Math.floor(t / MINUTE_MS);
      let hi = Math.ceil(next / MINUTE_MS);
      while (hi - lo > 1) {
        const mid = lo + Math.floor((hi - lo) / 2);
        if (off(mid * MINUTE_MS) === before) lo = mid;
        else hi = mid;
      }
      const at = hi * MINUTE_MS;
      segments.push({ from: at, offsetMs: off(at) });
    }
    t = next;
  }
  return segments;
}

export interface FormatOptions {
  locale: string;
  timeZone: string;
}

/** `Sep 3, 2026, 6:30 PM` in the locale, read in the zone. */
export function formatDateTime(
  epochMs: number,
  options: FormatOptions,
): string {
  return new Intl.DateTimeFormat(options.locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: resolveTimeZone(options.timeZone),
  }).format(new Date(epochMs));
}

/** `Sep 3, 2026` in the locale, read in the zone. */
export function formatDate(epochMs: number, options: FormatOptions): string {
  return new Intl.DateTimeFormat(options.locale, {
    dateStyle: "medium",
    timeZone: resolveTimeZone(options.timeZone),
  }).format(new Date(epochMs));
}

/** `2026-09-03T18:30:15-05:00`: the wall-clock reading plus the zone's offset (UTC = `+00:00`). */
export function formatIsoWithOffset(epochMs: number, zone: string): string {
  const name = resolveTimeZone(zone);
  const w = wallClock(epochMs, name);
  const offset = tzOffsetMs(epochMs, name);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset) / MINUTE_MS;
  return (
    `${String(w.year).padStart(4, "0")}-${pad2(w.month)}-${pad2(w.day)}` +
    `T${pad2(w.hour)}:${pad2(w.minute)}:${pad2(w.second)}` +
    `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  );
}
