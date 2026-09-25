/**
 * How many funnel events one `recordEventsAction` call carries.
 *
 * A screen of several questions records one event per question, and the
 * engine does not cap a screen: the builder's cap of ten is the builder's, so
 * a screen written through the API can hold more. The renderer sends such a
 * screen's events in batches of this size, and the action never fans out
 * further than this in one call.
 */
export const EVENTS_PER_CALL = 24;

/** Consecutive batches of at most {@link EVENTS_PER_CALL}, in order. */
export function eventBatches<T>(events: readonly T[]): T[][] {
  const batches: T[][] = [];
  for (let at = 0; at < events.length; at += EVENTS_PER_CALL) batches.push(events.slice(at, at + EVENTS_PER_CALL));
  return batches;
}
