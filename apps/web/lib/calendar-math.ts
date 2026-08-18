/**
 * Pure calendar arithmetic for the branded date picker. No React, no I/O.
 *
 * Everything here is UTC on purpose: the analytics range is resolved server-side
 * as `${from}T00:00:00.000Z` .. `${to}T23:59:59.999Z` (SPEC-METRICS.md, phase 1),
 * so the picker must reason in the same calendar or a viewer west of Greenwich
 * would be offered a "today" the server treats as tomorrow. Dates travel as
 * `YYYY-MM-DD` strings; the ISO shape sorts lexicographically, so range checks
 * are plain string compares. Months are 0-11 like `Date`.
 */

export interface YearMonth {
  year: number;
  /** 0-11 */
  month: number;
}

export interface CalendarDate extends YearMonth {
  /** 1-31 */
  day: number;
}

export interface GridCell {
  iso: string;
  /** False for the leading/trailing days that pad the 6x7 grid. */
  inMonth: boolean;
}

export interface WeekdayLabel {
  short: string;
  long: string;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Strict `YYYY-MM-DD` parse; rejects impossible dates (`2026-02-30`) and
 *  loosely padded input (`2026-8-1`) by round-tripping through `Date.UTC`. */
export function parseIsoDate(s: string): CalendarDate | null {
  const m = ISO_RE.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (month < 0 || month > 11 || day < 1) return null;
  const d = new Date(Date.UTC(year, month, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month || d.getUTCDate() !== day)
    return null;
  return { year, month, day };
}

export function toIsoDate(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month, day));
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Today's date in UTC, the same reference the server resolves ranges against. */
export function todayUtcIso(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function addDays(iso: string, n: number): string {
  const p = parseIsoDate(iso);
  if (!p) return iso;
  return toIsoDate(p.year, p.month, p.day + n);
}

export function addMonths({ year, month }: YearMonth, n: number): YearMonth {
  const d = new Date(Date.UTC(year, month + n, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

export function yearMonthOf(iso: string): YearMonth {
  const p = parseIsoDate(iso);
  if (p) return { year: p.year, month: p.month };
  const t = parseIsoDate(todayUtcIso());
  return t ? { year: t.year, month: t.month } : { year: 1970, month: 0 };
}

/** 1 (Monday) for Spanish, 0 (Sunday) otherwise. */
export function weekStartsOn(locale: string): 0 | 1 {
  return locale.toLowerCase().startsWith('es') ? 1 : 0;
}

/** Always 42 cells (6 rows x 7), padded with the neighbouring months so the
 *  popover never changes height while paging. */
export function monthGrid({ year, month }: YearMonth, weekStart: 0 | 1): GridCell[] {
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const lead = (firstDow - weekStart + 7) % 7;
  const cells: GridCell[] = [];
  for (let i = 0; i < 42; i++) {
    const day = i - lead + 1;
    const d = new Date(Date.UTC(year, month, day));
    cells.push({
      iso: toIsoDate(year, month, day),
      inMonth: d.getUTCMonth() === month && d.getUTCFullYear() === year,
    });
  }
  return cells;
}

/** Inclusive on both ends; string compare is safe for `YYYY-MM-DD`. */
export function isOutOfRange(iso: string, min?: string, max?: string): boolean {
  if (min && iso < min) return true;
  if (max && iso > max) return true;
  return false;
}

export function clampIso(iso: string, min?: string, max?: string): string {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

const capitalize = (s: string): string => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s);

/** Column headers, rotated to `weekStart`. 2023-01-01 is a Sunday, so the seven
 *  days from there enumerate Sun..Sat in UTC; Intl gives the locale's names and
 *  the trailing period some locales add (`lun.`) is stripped for the header. */
export function weekdayLabels(locale: string, weekStart: 0 | 1): WeekdayLabel[] {
  const short = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    timeZone: 'UTC',
  });
  const long = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    timeZone: 'UTC',
  });
  const out: WeekdayLabel[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.UTC(2023, 0, 1 + ((i + weekStart) % 7)));
    out.push({
      short: capitalize(short.format(d).replace(/\.$/, '')),
      long: capitalize(long.format(d)),
    });
  }
  return out;
}

/** "August 2026" / "Agosto 2026" (Intl gives Spanish lower-case, hence the cap). */
export function formatMonthTitle({ year, month }: YearMonth, locale: string): string {
  const s = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month, 1)));
  return capitalize(s);
}

/** en `Aug 18, 2026`, es `18 ago 2026`. Falls back to the raw string when it is
 *  not a valid ISO date so a bad URL param never throws in render. */
export function formatIsoDate(iso: string, locale: string): string {
  const p = parseIsoDate(iso);
  if (!p) return iso;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(p.year, p.month, p.day)));
}
