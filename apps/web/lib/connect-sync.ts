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
 * the loader awaits any pending write for the same form before it reads. It is a
 * plain client-side singleton (module scope survives the panel unmount/remount),
 * keyed by form id, holding only the latest in-flight write per form.
 */

const inflight = new Map<string, Promise<unknown>>();

/**
 * Record an in-flight destinations write so a subsequent read can wait for it.
 * The stored promise never rejects (failures are swallowed here — the caller
 * owns error reporting) and clears itself once settled, but only if it is still
 * the latest write for that id, so a newer write is never erased by an older
 * one resolving.
 */
export function trackDestinationWrite(id: string, write: Promise<unknown>): void {
  const settled = write.catch(() => {}).then(() => {
    if (inflight.get(id) === settled) inflight.delete(id);
  });
  inflight.set(id, settled);
}

/**
 * Resolve once the latest tracked write for this form has landed (immediately if
 * none is pending). Call this before reading destinations back so a read never
 * overtakes the write that was meant to precede it.
 */
export function awaitPendingDestinationWrite(id: string): Promise<unknown> {
  return inflight.get(id) ?? Promise.resolve();
}
