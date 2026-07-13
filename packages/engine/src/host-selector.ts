/**
 * Round-robin host selection — the "getLuckyUser" seam (cal.diy
 * `packages/features/bookings/lib/getLuckyUser`). Pure and deterministic so it
 * unit-tests without a DB.
 *
 * Contract (API-CONTRACT §Engine rules 1): the host is picked AFTER a slot is
 * selected, from the pool of hosts actually free at that slot. Fairness order:
 *   1. highest `priority` wins outright;
 *   2. among equal priority, weighted least-load — lowest
 *      bookingCount / weight (so a weight-200 host absorbs ~2× a weight-100 host);
 *   3. tie-break by least-recently-booked, then memberId (stable).
 *
 * Three team scheduling methods share this seam (all FREE in Dapta — the layer
 * Calendly/Cal.com paywall):
 *   - round_robin       → {@link selectLuckyHost}: one fair host from the pool.
 *   - collective        → every required host attends (assignment is trivially
 *     "all hosts" — the DB layer verifies all are free; no selector needed).
 *   - fixed_round_robin → {@link selectFixedRoundRobinHosts}: the fixed host(s)
 *     always present + one round-robin pick from the rotating rest.
 */

export interface HostCandidate {
  memberId: string;
  /** Higher = preferred. Absent → 0. */
  priority?: number | null;
  /** Relative load share. Absent/≤0 → 100. */
  weight?: number | null;
  /** Accepted bookings assigned to this host (load signal). */
  bookingCount: number;
  /** When this host was last booked (recency tie-break). Null = never. */
  lastBookedAt?: Date | null;
  /** fixed_round_robin: true = always on the booking; false = in the RR rotation. */
  isFixed?: boolean;
}

/**
 * Pick the fair host from a pool of candidates already known to be FREE at the
 * target slot. Returns null only for an empty pool.
 */
export function selectLuckyHost(candidates: HostCandidate[]): HostCandidate | null {
  if (candidates.length === 0) return null;

  const maxPriority = Math.max(...candidates.map(c => c.priority ?? 0));
  const pool = candidates.filter(c => (c.priority ?? 0) === maxPriority);

  return pool.reduce((best, cur) => (isBetter(cur, best) ? cur : best));
}

/** True if `a` should be preferred over `b` (lower weighted load, then recency). */
function isBetter(a: HostCandidate, b: HostCandidate): boolean {
  const la = weightedLoad(a);
  const lb = weightedLoad(b);
  if (la !== lb) return la < lb;

  const ra = a.lastBookedAt ? a.lastBookedAt.getTime() : -Infinity; // never-booked = most stale
  const rb = b.lastBookedAt ? b.lastBookedAt.getTime() : -Infinity;
  if (ra !== rb) return ra < rb;

  return a.memberId < b.memberId; // stable, deterministic
}

function weightedLoad(c: HostCandidate): number {
  const weight = c.weight && c.weight > 0 ? c.weight : 100;
  return c.bookingCount / weight;
}

/**
 * fixed_round_robin (Cal.com parity): the assigned host set is EVERY fixed host
 * plus ONE round-robin pick from the rotating (non-fixed) hosts. `freeCandidates`
 * is the pool of hosts actually free at the slot; the caller (DB layer) has
 * already verified the fixed hosts are among them (a missing fixed host = the
 * slot is unbookable). Returns null only for a fully empty pool.
 */
export function selectFixedRoundRobinHosts(freeCandidates: HostCandidate[]): HostCandidate[] | null {
  if (freeCandidates.length === 0) return null;
  const fixed = freeCandidates.filter(c => c.isFixed);
  const rotating = freeCandidates.filter(c => !c.isFixed);
  const lucky = selectLuckyHost(rotating);
  const assigned = [...fixed];
  if (lucky) assigned.push(lucky);
  return assigned.length > 0 ? assigned : null;
}
