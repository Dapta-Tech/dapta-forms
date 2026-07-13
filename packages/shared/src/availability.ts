/**
 * Availability-editor logic (ported from the OLD FE `availability.util.ts`).
 * Pure helpers the schedule editor uses to convert between the wire shape
 * (per-weekday time blocks) and the editor's day-rows, validate ranges, and
 * copy one day's ranges to others. Times are "HH:MM" 24h wall-clock strings.
 */

export interface TimeRange {
  start: string; // "09:00"
  end: string; // "17:00"
}

/** 0 = Sunday … 6 = Saturday, matching JS getDay(). */
export type WeekdayRanges = Record<number, TimeRange[]>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Validate a single day's ranges: each well-formed, end>start, and no overlap
 * once sorted. Returns null if OK, else the first problem's message.
 */
export function validateDayRanges(ranges: TimeRange[]): string | null {
  for (const r of ranges) {
    if (!HHMM.test(r.start) || !HHMM.test(r.end)) return 'Use HH:MM times.';
    if (toMinutes(r.end) <= toMinutes(r.start)) return 'End must be after start.';
  }
  const sorted = [...ranges].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  for (let i = 1; i < sorted.length; i++) {
    if (toMinutes(sorted[i]!.start) < toMinutes(sorted[i - 1]!.end)) return 'Time ranges overlap.';
  }
  return null;
}

/** Copy one day's ranges to a set of target weekdays (returns a new map). */
export function copyRangesToDays(
  current: WeekdayRanges,
  fromDay: number,
  toDays: number[],
): WeekdayRanges {
  const src = current[fromDay] ?? [];
  const next: WeekdayRanges = { ...current };
  for (const d of toDays) next[d] = src.map((r) => ({ ...r }));
  return next;
}

/** Flatten the editor's weekday map into the wire "rules" shape (one row per range). */
export function daysToBlocks(byDay: WeekdayRanges): Array<{ day: number; start: string; end: string }> {
  const out: Array<{ day: number; start: string; end: string }> = [];
  for (const [day, ranges] of Object.entries(byDay)) {
    for (const r of ranges) out.push({ day: Number(day), start: r.start, end: r.end });
  }
  return out;
}

/** Group wire "rules" back into the editor's per-weekday map. */
export function blocksToDays(blocks: Array<{ day: number; start: string; end: string }>): WeekdayRanges {
  const byDay: WeekdayRanges = {};
  for (const b of blocks) {
    (byDay[b.day] ??= []).push({ start: b.start, end: b.end });
  }
  return byDay;
}
