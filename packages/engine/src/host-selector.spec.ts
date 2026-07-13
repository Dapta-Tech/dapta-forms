import { HostCandidate, selectLuckyHost, selectFixedRoundRobinHosts } from './host-selector';

const host = (memberId: string, over: Partial<HostCandidate> = {}): HostCandidate => ({
  memberId,
  bookingCount: 0,
  ...over,
});

describe('selectLuckyHost', () => {
  it('returns null for an empty pool', () => {
    expect(selectLuckyHost([])).toBeNull();
  });

  it('prefers the highest-priority host outright', () => {
    const picked = selectLuckyHost([
      host('a', { priority: 0, bookingCount: 0 }),
      host('b', { priority: 5, bookingCount: 99 }), // busiest but top priority
    ]);
    expect(picked?.memberId).toBe('b');
  });

  it('among equal priority, picks the least-loaded (weight-normalized)', () => {
    const picked = selectLuckyHost([
      host('a', { bookingCount: 10, weight: 100 }), // load 0.10
      host('b', { bookingCount: 15, weight: 200 }), // load 0.075 → wins
    ]);
    expect(picked?.memberId).toBe('b');
  });

  it('tie-breaks equal load by least-recently-booked', () => {
    const picked = selectLuckyHost([
      host('a', { bookingCount: 1, lastBookedAt: new Date('2026-07-01T00:00:00Z') }),
      host('b', { bookingCount: 1, lastBookedAt: new Date('2026-06-01T00:00:00Z') }), // staler → wins
    ]);
    expect(picked?.memberId).toBe('b');
  });

  it('treats a never-booked host as the most stale', () => {
    const picked = selectLuckyHost([
      host('a', { bookingCount: 0, lastBookedAt: new Date('2026-07-01T00:00:00Z') }),
      host('b', { bookingCount: 0, lastBookedAt: null }), // never booked → wins
    ]);
    expect(picked?.memberId).toBe('b');
  });

  it('is deterministic on a full tie (stable by memberId)', () => {
    const pool = [host('z'), host('a'), host('m')];
    expect(selectLuckyHost(pool)?.memberId).toBe('a');
    expect(selectLuckyHost([...pool].reverse())?.memberId).toBe('a');
  });

  it('defaults missing weight to 100', () => {
    const picked = selectLuckyHost([
      host('a', { bookingCount: 1 }), // weight→100, load 0.01
      host('b', { bookingCount: 3, weight: 100 }), // load 0.03
    ]);
    expect(picked?.memberId).toBe('a');
  });
});

describe('selectFixedRoundRobinHosts', () => {
  it('returns null for an empty pool', () => {
    expect(selectFixedRoundRobinHosts([])).toBeNull();
  });

  it('keeps every fixed host and adds one RR pick from the rotating rest', () => {
    const assigned = selectFixedRoundRobinHosts([
      host('fixed', { isFixed: true, bookingCount: 99 }), // always present despite load
      host('rot-a', { bookingCount: 5 }),
      host('rot-b', { bookingCount: 1 }), // least loaded → the RR pick
    ]);
    expect(assigned?.map((h) => h.memberId).sort()).toEqual(['fixed', 'rot-b']);
  });

  it('supports multiple fixed hosts (all attend) plus one rotating pick', () => {
    const assigned = selectFixedRoundRobinHosts([
      host('f1', { isFixed: true }),
      host('f2', { isFixed: true }),
      host('rot-a', { bookingCount: 2 }),
      host('rot-b', { bookingCount: 9 }),
    ]);
    expect(assigned?.map((h) => h.memberId).sort()).toEqual(['f1', 'f2', 'rot-a']);
  });

  it('with no fixed hosts behaves like plain round-robin (one pick)', () => {
    const assigned = selectFixedRoundRobinHosts([
      host('a', { bookingCount: 4 }),
      host('b', { bookingCount: 1 }),
    ]);
    expect(assigned?.map((h) => h.memberId)).toEqual(['b']);
  });

  it('with only fixed hosts free returns just the fixed set', () => {
    const assigned = selectFixedRoundRobinHosts([host('f1', { isFixed: true })]);
    expect(assigned?.map((h) => h.memberId)).toEqual(['f1']);
  });
});
