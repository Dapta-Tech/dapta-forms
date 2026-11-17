/**
 * Cross-component ordering for the Connect tab's destination writes.
 *
 * The Connect tab's Integrations section refetches destinations from the server
 * every time the tab is (re)activated, while an edit still in the debounce
 * window is flushed on unmount with a fire-and-forget server action. Switching
 * Connect → Build → Connect fast therefore let the remount's READ overtake the
 * previous tab's WRITE: the panel came back with a stale config, and the next
 * edit wrote that stale state back — silently dropping a just-saved webhook
 * (V4-05 race). Nothing serialised the two calls.
 *
 * This module is that serialisation point. A write registers its promise here;
 * the loader awaits every pending write for the same form before it reads. It
 * is a plain client-side singleton (module scope survives the panel
 * unmount/remount), keyed by form id.
 *
 * EVERY pending write is held, not only the latest. An action a card started
 * (creating a spreadsheet) can outlive the tab and finish after the save the
 * tab flushed on its way out; with one slot per form, that flush replaced the
 * action's entry and a remount read the form before the sheet was attached.
 */

const inflight = new Map<string, Set<Promise<unknown>>>();

/**
 * Record an in-flight destinations write so a subsequent read can wait for it.
 * The stored promise never rejects (failures are swallowed here: the caller
 * owns error reporting) and removes itself once settled.
 */
export function trackDestinationWrite(id: string, write: Promise<unknown>): void {
  let set = inflight.get(id);
  if (!set) {
    set = new Set();
    inflight.set(id, set);
  }
  const mine = set;
  const settled: Promise<unknown> = write
    .catch(() => {})
    .then(() => {
      mine.delete(settled);
      if (mine.size === 0 && inflight.get(id) === mine) inflight.delete(id);
    });
  mine.add(settled);
}

/**
 * Resolve once every tracked write for this form has landed (immediately if
 * none is pending), including one registered while waiting: a late action's
 * result is saved through the form's queue, which registers itself as the
 * action settles. Call this before reading destinations back so a read never
 * overtakes a write that was meant to precede it.
 */
export async function awaitPendingDestinationWrite(id: string): Promise<void> {
  for (;;) {
    const set = inflight.get(id);
    if (!set || set.size === 0) return;
    await Promise.all([...set]);
  }
}
