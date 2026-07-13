/**
 * Timezone projection utilities — dependency-free (uses the platform `Intl`
 * timezone database), so recurring wall-clock availability projects to correct
 * UTC instants across DST boundaries WITHOUT storing offsets (schema-design.md
 * §6). No luxon/date-fns-tz dependency added.
 *
 * The core trick: to place a wall-clock time in a zone onto the UTC line we
 * guess "as if UTC", read the zone's actual offset at that guess via
 * `Intl.DateTimeFormat`, then correct — re-reading once so a guess that landed
 * on the wrong side of a DST transition still resolves correctly.
 */

/** Civil (zone-less) calendar date + time. `month` is 1-12, `day` 1-31. */
export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const PARTS_FORMAT_CACHE = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = PARTS_FORMAT_CACHE.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    PARTS_FORMAT_CACHE.set(timeZone, f);
  }
  return f;
}

/** The zone's UTC offset (ms, = local − utc) at a given instant. */
export function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  // `h23` renders midnight as 00 (not 24), so this is safe.
  const asUtcMs = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
  return asUtcMs - instant.getTime();
}

/**
 * The UTC instant of a wall-clock time in `timeZone`. Correct across DST:
 * spring-forward gaps resolve forward, fall-back ambiguity picks the first
 * (pre-transition) offset — deterministic either way.
 */
export function zonedWallClockToUtc(wc: WallClock, timeZone: string): Date {
  const naiveUtcMs = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, 0);
  const off1 = tzOffsetMs(new Date(naiveUtcMs), timeZone);
  let candidate = naiveUtcMs - off1;
  const off2 = tzOffsetMs(new Date(candidate), timeZone);
  if (off2 !== off1) {
    candidate = naiveUtcMs - off2;
  }
  return new Date(candidate);
}

/** The civil Y-M-D (and weekday 0=Sun..6=Sat) of an instant, seen in `timeZone`. */
export function localDateParts(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; weekday: number } {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  // Weekday: derive from the civil date (offset-independent). Date.UTC on the
  // civil Y-M-D gives a stable day-of-week regardless of zone.
  const weekday = new Date(Date.UTC(map.year, map.month - 1, map.day)).getUTCDay();
  return { year: map.year, month: map.month, day: map.day, weekday };
}

/** Parse "HH:mm" or "HH:mm:ss" wall-clock into hour/minute. */
export function parseTimeOfDay(t: string): { hour: number; minute: number } {
  const [h, m] = t.split(':');
  return { hour: Number(h), minute: Number(m) };
}

/** Civil-date helpers: increment a Y-M-D by one calendar day (DST-independent). */
export function nextCivilDate(d: { year: number; month: number; day: number }): {
  year: number;
  month: number;
  day: number;
} {
  const dt = new Date(Date.UTC(d.year, d.month - 1, d.day));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

/** Compare two civil dates (ignoring time). */
export function civilDateLte(
  a: { year: number; month: number; day: number },
  b: { year: number; month: number; day: number },
): boolean {
  if (a.year !== b.year) return a.year < b.year;
  if (a.month !== b.month) return a.month < b.month;
  return a.day <= b.day;
}

/** The day-of-week (0=Sun..6=Sat) of a civil date. */
export function civilWeekday(d: { year: number; month: number; day: number }): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

/** Format a civil date as "YYYY-MM-DD" (matches a Postgres `date` column). */
export function civilDateString(d: { year: number; month: number; day: number }): string {
  const mm = String(d.month).padStart(2, '0');
  const dd = String(d.day).padStart(2, '0');
  return `${d.year}-${mm}-${dd}`;
}
