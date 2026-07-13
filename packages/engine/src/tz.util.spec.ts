import { localDateParts, tzOffsetMs, zonedWallClockToUtc } from './tz.util';

describe('tz.util', () => {
  describe('zonedWallClockToUtc', () => {
    it('projects a no-DST zone (America/Bogota, UTC-5) correctly', () => {
      const utc = zonedWallClockToUtc(
        { year: 2026, month: 7, day: 6, hour: 9, minute: 0 },
        'America/Bogota',
      );
      expect(utc.toISOString()).toBe('2026-07-06T14:00:00.000Z');
    });

    it('uses EST (UTC-5) BEFORE the US spring-forward boundary', () => {
      // 2026-03-07 09:00 America/New_York is still EST → 14:00 UTC.
      const utc = zonedWallClockToUtc(
        { year: 2026, month: 3, day: 7, hour: 9, minute: 0 },
        'America/New_York',
      );
      expect(utc.toISOString()).toBe('2026-03-07T14:00:00.000Z');
    });

    it('uses EDT (UTC-4) AFTER the US spring-forward boundary', () => {
      // 2026-03-08 (DST starts 02:00) 09:00 America/New_York is EDT → 13:00 UTC.
      const utc = zonedWallClockToUtc(
        { year: 2026, month: 3, day: 8, hour: 9, minute: 0 },
        'America/New_York',
      );
      expect(utc.toISOString()).toBe('2026-03-08T13:00:00.000Z');
    });

    it('uses EDT before and EST after the US fall-back boundary', () => {
      expect(
        zonedWallClockToUtc(
          { year: 2026, month: 10, day: 31, hour: 9, minute: 0 },
          'America/New_York',
        ).toISOString(),
      ).toBe('2026-10-31T13:00:00.000Z'); // EDT (-4)
      expect(
        zonedWallClockToUtc(
          { year: 2026, month: 11, day: 1, hour: 9, minute: 0 },
          'America/New_York',
        ).toISOString(),
      ).toBe('2026-11-01T14:00:00.000Z'); // EST (-5)
    });
  });

  describe('tzOffsetMs', () => {
    it('reports -5h in EST and -4h in EDT', () => {
      const H = 3_600_000;
      expect(tzOffsetMs(new Date('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(-5 * H);
      expect(tzOffsetMs(new Date('2026-07-15T12:00:00Z'), 'America/New_York')).toBe(-4 * H);
    });
  });

  describe('localDateParts', () => {
    it('returns the civil date + weekday as seen in the zone', () => {
      // 2026-07-06T02:00Z is 2026-07-05 21:00 in Bogota (−5) → previous day.
      const p = localDateParts(new Date('2026-07-06T02:00:00Z'), 'America/Bogota');
      expect(p).toEqual({ year: 2026, month: 7, day: 5, weekday: 0 }); // Sunday
    });
  });
});
