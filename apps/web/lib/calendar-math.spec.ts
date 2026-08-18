import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  clampIso,
  daysInMonth,
  formatIsoDate,
  formatMonthTitle,
  isOutOfRange,
  monthGrid,
  parseIsoDate,
  todayUtcIso,
  toIsoDate,
  weekdayLabels,
  weekStartsOn,
  yearMonthOf,
} from './calendar-math';

describe('calendar-math', () => {
  it('parseIsoDate accepts strict YYYY-MM-DD and rejects impossible or unpadded dates', () => {
    expect(parseIsoDate('2026-08-18')).toEqual({
      year: 2026,
      month: 7,
      day: 18,
    });
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('2026-8-1')).toBeNull();
    expect(parseIsoDate('2026-13-01')).toBeNull();
    expect(parseIsoDate('')).toBeNull();
    expect(parseIsoDate('2024-02-29')).toEqual({
      year: 2024,
      month: 1,
      day: 29,
    });
    expect(parseIsoDate('2023-02-29')).toBeNull();
  });

  it('toIsoDate pads and normalises overflow through Date.UTC', () => {
    expect(toIsoDate(2026, 7, 1)).toBe('2026-08-01');
    expect(toIsoDate(2026, 0, 32)).toBe('2026-02-01');
  });

  it('todayUtcIso reads the UTC calendar day', () => {
    expect(todayUtcIso(Date.UTC(2026, 7, 18, 23, 59))).toBe('2026-08-18');
    expect(todayUtcIso(Date.UTC(2026, 7, 19, 0, 0))).toBe('2026-08-19');
  });

  it('daysInMonth handles leap years', () => {
    expect(daysInMonth(2024, 1)).toBe(29);
    expect(daysInMonth(2023, 1)).toBe(28);
    expect(daysInMonth(2026, 7)).toBe(31);
  });

  it('addDays crosses year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2026-08-18', -7)).toBe('2026-08-11');
  });

  it('addMonths rolls Dec into Jan and back', () => {
    expect(addMonths({ year: 2026, month: 11 }, 1)).toEqual({
      year: 2027,
      month: 0,
    });
    expect(addMonths({ year: 2027, month: 0 }, -1)).toEqual({
      year: 2026,
      month: 11,
    });
    expect(addMonths({ year: 2026, month: 7 }, 12)).toEqual({
      year: 2027,
      month: 7,
    });
  });

  it('yearMonthOf reads a valid ISO date', () => {
    expect(yearMonthOf('2026-08-18')).toEqual({ year: 2026, month: 7 });
  });

  it('weekStartsOn: Spanish starts on Monday, everything else on Sunday', () => {
    expect(weekStartsOn('es')).toBe(1);
    expect(weekStartsOn('es-MX')).toBe(1);
    expect(weekStartsOn('en')).toBe(0);
    expect(weekStartsOn('fr')).toBe(0);
  });

  it('monthGrid always yields 42 cells, padded per week start', () => {
    const sun = monthGrid({ year: 2026, month: 7 }, 0);
    expect(sun).toHaveLength(42);
    expect(sun[0]?.iso).toBe('2026-07-26');
    expect(sun[0]?.inMonth).toBe(false);
    const mon = monthGrid({ year: 2026, month: 7 }, 1);
    expect(mon).toHaveLength(42);
    expect(mon[0]?.iso).toBe('2026-07-27');
    expect(monthGrid({ year: 2024, month: 1 }, 0).filter((c) => c.inMonth)).toHaveLength(29);
    expect(monthGrid({ year: 2023, month: 1 }, 0).filter((c) => c.inMonth)).toHaveLength(28);
  });

  it('isOutOfRange and clampIso are inclusive on both ends', () => {
    expect(isOutOfRange('2026-08-18', '2026-08-18', '2026-08-18')).toBe(false);
    expect(isOutOfRange('2026-08-17', '2026-08-18', undefined)).toBe(true);
    expect(isOutOfRange('2026-08-19', undefined, '2026-08-18')).toBe(true);
    expect(isOutOfRange('2026-08-19')).toBe(false);
    expect(clampIso('2026-08-19', undefined, '2026-08-18')).toBe('2026-08-18');
    expect(clampIso('2026-08-01', '2026-08-05', undefined)).toBe('2026-08-05');
    expect(clampIso('2026-08-10', '2026-08-05', '2026-08-18')).toBe('2026-08-10');
  });

  it('weekdayLabels rotate to the week start and strip trailing periods', () => {
    const es = weekdayLabels('es', 1);
    expect(es).toHaveLength(7);
    expect(es[0]?.short.toLowerCase().startsWith('lun')).toBe(true);
    expect(es[0]?.short.endsWith('.')).toBe(false);
    const en = weekdayLabels('en', 0);
    expect(en[0]?.short).toBe('Sun');
    expect(en[0]?.long).toBe('Sunday');
    expect(en[6]?.short).toBe('Sat');
  });

  it('formatIsoDate and formatMonthTitle localise in UTC', () => {
    expect(formatIsoDate('2026-08-18', 'en')).toBe('Aug 18, 2026');
    expect(formatIsoDate('2026-08-18', 'es')).toMatch(/18 ago/);
    expect(formatIsoDate('not-a-date', 'en')).toBe('not-a-date');
    expect(formatMonthTitle({ year: 2026, month: 7 }, 'en')).toBe('August 2026');
    const es = formatMonthTitle({ year: 2026, month: 7 }, 'es');
    expect(es.startsWith('A')).toBe(true);
    expect(es).toMatch(/2026/);
  });
});
