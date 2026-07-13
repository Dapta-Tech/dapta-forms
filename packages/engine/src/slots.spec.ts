import {
  AvailabilityRule,
  computeSlots,
  Interval,
  mergeIntervals,
  unionInstants,
  intersectInstants,
} from './slots';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const iso = (slots: Date[]) => slots.map(d => d.toISOString());

/** A recurring block on every weekday. */
function recurring(startTime: string, endTime: string): AvailabilityRule {
  return { days: ALL_DAYS, startTime, endTime, date: null };
}

describe('computeSlots', () => {
  const NOW_EARLY = new Date('2026-01-01T00:00:00Z'); // far before any test window

  describe('basic generation (America/Bogota, no DST)', () => {
    const base = {
      timeZone: 'America/Bogota',
      availability: [recurring('09:00', '11:00')],
      durationMin: 30,
      slotIntervalMin: 30,
      busy: [] as Interval[],
      now: NOW_EARLY,
      // Local Jul 6 00:00 → 05:00Z; one full local day.
      fromUtc: new Date('2026-07-06T05:00:00Z'),
      toUtc: new Date('2026-07-07T05:00:00Z'),
    };

    it('generates evenly-stepped slots inside the block', () => {
      expect(iso(computeSlots(base))).toEqual([
        '2026-07-06T14:00:00.000Z', // 09:00 local
        '2026-07-06T14:30:00.000Z',
        '2026-07-06T15:00:00.000Z',
        '2026-07-06T15:30:00.000Z', // 10:30–11:00 local, last that fits
      ]);
    });

    it('subtracts an overlapping busy interval (adjacent slots survive)', () => {
      const busy = [
        { start: new Date('2026-07-06T14:30:00Z'), end: new Date('2026-07-06T15:00:00Z') },
      ];
      expect(iso(computeSlots({ ...base, busy }))).toEqual([
        '2026-07-06T14:00:00.000Z',
        '2026-07-06T15:00:00.000Z',
        '2026-07-06T15:30:00.000Z',
      ]);
    });

    it('treats existing bookings and reservations identically (same busy union)', () => {
      // One "accepted booking" + one "active reservation", merged as busy.
      const busy = [
        { start: new Date('2026-07-06T14:00:00Z'), end: new Date('2026-07-06T14:30:00Z') }, // booking
        { start: new Date('2026-07-06T15:00:00Z'), end: new Date('2026-07-06T15:30:00Z') }, // reservation
      ];
      expect(iso(computeSlots({ ...base, busy }))).toEqual([
        '2026-07-06T14:30:00.000Z',
        '2026-07-06T15:30:00.000Z',
      ]);
    });

    it('applies before/after buffers around the candidate', () => {
      const busy = [
        { start: new Date('2026-07-06T14:30:00Z'), end: new Date('2026-07-06T15:00:00Z') },
      ];
      // 15-min buffers knock out both neighbours of the busy block; only the
      // 15:30 slot sits clear of the buffered busy window.
      expect(iso(computeSlots({ ...base, busy, beforeBufferMin: 15, afterBufferMin: 15 }))).toEqual(
        ['2026-07-06T15:30:00.000Z'],
      );
    });

    it('excludes slots before now + minimumBookingNotice', () => {
      const now = new Date('2026-07-06T14:10:00Z');
      expect(iso(computeSlots({ ...base, now, minimumBookingNoticeMin: 60 }))).toEqual([
        '2026-07-06T15:30:00.000Z', // earliest = 15:10Z → only 15:30 qualifies
      ]);
    });
  });

  describe('DST correctness (America/New_York)', () => {
    it('spring-forward: the same 09:00 block yields −4h on the post-DST day', () => {
      const slots = iso(
        computeSlots({
          timeZone: 'America/New_York',
          availability: [recurring('09:00', '10:00')],
          durationMin: 60,
          busy: [],
          now: NOW_EARLY,
          fromUtc: new Date('2026-03-07T00:00:00Z'),
          toUtc: new Date('2026-03-09T00:00:00Z'),
        }),
      );
      // Mar 7 is EST (09:00→14:00Z); Mar 8 (DST on) is EDT (09:00→13:00Z).
      expect(slots).toEqual(['2026-03-07T14:00:00.000Z', '2026-03-08T13:00:00.000Z']);
    });

    it('fall-back: the same 09:00 block yields −5h on the post-DST day', () => {
      const slots = iso(
        computeSlots({
          timeZone: 'America/New_York',
          availability: [recurring('09:00', '10:00')],
          durationMin: 60,
          busy: [],
          now: NOW_EARLY,
          fromUtc: new Date('2026-10-31T00:00:00Z'),
          toUtc: new Date('2026-11-02T00:00:00Z'),
        }),
      );
      // Oct 31 EDT (09:00→13:00Z); Nov 1 (DST off) EST (09:00→14:00Z).
      expect(slots).toEqual(['2026-10-31T13:00:00.000Z', '2026-11-01T14:00:00.000Z']);
    });
  });

  describe('date overrides', () => {
    it('a date override replaces recurring rules for that calendar date', () => {
      const slots = iso(
        computeSlots({
          timeZone: 'America/Bogota',
          availability: [
            recurring('09:00', '10:00'),
            { days: null, startTime: '13:00', endTime: '14:00', date: '2026-07-06' },
          ],
          durationMin: 60,
          busy: [],
          now: NOW_EARLY,
          fromUtc: new Date('2026-07-06T05:00:00Z'),
          toUtc: new Date('2026-07-07T05:00:00Z'),
        }),
      );
      // On 2026-07-06 the override wins: 13:00 local → 18:00Z; 09:00 suppressed.
      expect(slots).toEqual(['2026-07-06T18:00:00.000Z']);
    });
  });
});

describe('mergeIntervals', () => {
  it('merges overlapping and adjacent intervals', () => {
    const merged = mergeIntervals([
      { start: new Date('2026-07-06T10:00:00Z'), end: new Date('2026-07-06T11:00:00Z') },
      { start: new Date('2026-07-06T10:30:00Z'), end: new Date('2026-07-06T11:30:00Z') }, // overlaps
      { start: new Date('2026-07-06T11:30:00Z'), end: new Date('2026-07-06T12:00:00Z') }, // adjacent
      { start: new Date('2026-07-06T13:00:00Z'), end: new Date('2026-07-06T13:30:00Z') }, // separate
    ]);
    expect(iso(merged.map(m => m.start))).toEqual([
      '2026-07-06T10:00:00.000Z',
      '2026-07-06T13:00:00.000Z',
    ]);
    expect(iso(merged.map(m => m.end))).toEqual([
      '2026-07-06T12:00:00.000Z',
      '2026-07-06T13:30:00.000Z',
    ]);
  });
});

describe('unionInstants (round-robin team availability)', () => {
  it('offers a slot if any host is free, sorted and de-duplicated', () => {
    expect(unionInstants([new Set([30, 10]), new Set([10, 20])])).toEqual([10, 20, 30]);
  });

  it('returns empty for no hosts', () => {
    expect(unionInstants([])).toEqual([]);
  });
});

describe('intersectInstants (collective team availability)', () => {
  it('offers a slot only if every host is free', () => {
    expect(intersectInstants([new Set([10, 20, 30]), new Set([20, 30, 40]), new Set([30, 20])])).toEqual([20, 30]);
  });

  it('is empty when the hosts never overlap', () => {
    expect(intersectInstants([new Set([1, 2]), new Set([3, 4])])).toEqual([]);
  });

  it('is empty when any host has no free slots', () => {
    expect(intersectInstants([new Set([1, 2]), new Set()])).toEqual([]);
  });

  it('returns empty for no hosts', () => {
    expect(intersectInstants([])).toEqual([]);
  });

  it('with a single host equals that host free set (sorted)', () => {
    expect(intersectInstants([new Set([30, 10, 20])])).toEqual([10, 20, 30]);
  });
});
