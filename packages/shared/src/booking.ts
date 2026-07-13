/**
 * Is a nav item active for the current path? Exact-match a root href like
 * "/admin" (so it doesn't light up on every sub-route); prefix-match everything
 * else, honouring extra `matches` (e.g. Settings also owns /admin/connections).
 * Pure + framework-agnostic so the shell's active-state logic is unit-testable.
 */
export function isNavItemActive(pathname: string, href: string, matches?: string[]): boolean {
  if (href === '/admin') return pathname === '/admin';
  const targets = matches ?? [href];
  return targets.some((t) => pathname === t || pathname.startsWith(`${t}/`));
}

/**
 * Slot-grouping helpers (ported from the original FE booking util). Slots are
 * absolute UTC instants; regrouping them by the visitor's zone needs no refetch.
 */
import { formatDayHeading, formatSlotTime, zonedDayKey } from './time';

/** A slot as returned by the availability API. */
export interface Slot {
  startUtc: string;
  /** Group events (R23): seats left / total. Absent for 1:1 events. */
  spotsLeft?: number;
  capacity?: number;
}

/** A slot rendered for display: the UTC instant plus its label in the visitor's zone. */
export interface DisplaySlot {
  startUtc: string;
  label: string;
  spotsLeft?: number;
  capacity?: number;
}

/** All slots that fall on one calendar day (in the visitor's zone). */
export interface SlotDay {
  dayKey: string;
  heading: string;
  slots: DisplaySlot[];
}

/**
 * Group UTC slot instants into day buckets AS SEEN IN `visitorTimeZone`, each
 * slot labelled with its local clock time. Days and slots come back sorted
 * ascending.
 */
export function groupSlotsByDay(slots: Slot[], visitorTimeZone: string): SlotDay[] {
  const byDay = new Map<string, DisplaySlot[]>();
  for (const slot of slots) {
    const dayKey = zonedDayKey(slot.startUtc, visitorTimeZone);
    const display: DisplaySlot = {
      startUtc: slot.startUtc,
      label: formatSlotTime(slot.startUtc, visitorTimeZone),
      spotsLeft: slot.spotsLeft,
      capacity: slot.capacity,
    };
    const bucket = byDay.get(dayKey);
    if (bucket) bucket.push(display);
    else byDay.set(dayKey, [display]);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dayKey, daySlots]) => ({
      dayKey,
      heading: formatDayHeading(daySlots[0]!.startUtc, visitorTimeZone),
      slots: daySlots.sort((a, b) =>
        a.startUtc < b.startUtc ? -1 : a.startUtc > b.startUtc ? 1 : 0,
      ),
    }));
}
