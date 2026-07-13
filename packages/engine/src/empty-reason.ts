/**
 * Machine-readable reasons an availability window came back empty because of
 * CONFIGURATION, not genuine busyness. `computeSlots` returning [] with no
 * reason attached means real emptiness (fully booked / out of range) — the
 * distinction Felipe asked for: config errors must be recognizable.
 */
export const AVAILABILITY_EMPTY_REASONS = [
  /** event_type.schedule_id points at a schedule row that no longer exists. */
  'SCHEDULE_MISSING',
  /** Neither the event nor the member has any schedule configured. */
  'NO_SCHEDULE',
  /** A schedule resolved, but it has zero availability rules (no weekly hours). */
  'NO_HOURS',
  /** External calendar busy-fetch failed — slots withheld (fail-closed). */
  'CALENDAR_UNAVAILABLE',
  /** Team event with no hosts assigned (team-only; never returned by the classifier). */
  'NO_HOSTS',
] as const;
export type AvailabilityEmptyReason = (typeof AVAILABILITY_EMPTY_REASONS)[number];

export interface ScheduleResolution {
  /** The schedule id the event type references (null when unset). */
  referencedScheduleId: string | null;
  /** Whether that referenced schedule row actually exists. */
  referencedScheduleExists: boolean;
  /** Whether a fallback (member default) schedule resolved. */
  fallbackScheduleExists: boolean;
  /** Availability rules loaded for the schedule that won resolution (0 if none won). */
  ruleCount: number;
}

/**
 * Classify a schedule resolution into a config-error reason, or null when the
 * configuration is sound (any emptiness is then genuine).
 *
 * A dangling reference that still lands on a working fallback schedule is NOT
 * flagged here: slots flow from the member default, matching pre-existing
 * behavior. The delete-guard keeps new dangling ids from appearing at all.
 */
export function classifyEmptyReason(r: ScheduleResolution): AvailabilityEmptyReason | null {
  const dangling = r.referencedScheduleId !== null && !r.referencedScheduleExists;
  const resolved = r.referencedScheduleExists || r.fallbackScheduleExists;
  if (!resolved) return dangling ? 'SCHEDULE_MISSING' : 'NO_SCHEDULE';
  if (r.ruleCount === 0) return 'NO_HOURS';
  return null;
}
