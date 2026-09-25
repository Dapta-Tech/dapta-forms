/**
 * Whole-screen swaps inside a public form, told to whoever embeds it.
 *
 * When a renderer replaces its whole screen (the submitting screen, a reveal,
 * the booking screen, the ending), the new content starts at the top of the
 * page. Standing alone, the browser shows it. Embedded, the page IS an iframe
 * sized to its content on someone else's site, and the person is usually
 * scrolled to wherever the button they just pressed was: on a long one-page
 * form that is far below the frame's top, where the new screen sits.
 *
 * The renderer only announces the swap, as a plain window event. The embed
 * height reporter, mounted on `?embed=1` renders alone, is what turns it into a
 * message to the host page. Everywhere else (the standalone page, the builder
 * preview) nobody listens and the event is a no-op.
 */
import { useEffect, useRef } from 'react';

/** Dispatched on `window` when a renderer swaps its whole screen. */
export const EMBED_SCREEN_EVENT = 'dapta-forms:screen-change';

export function announceScreenChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(EMBED_SCREEN_EVENT));
}

/**
 * Announce every change of `screen`, never the first value: a page that has
 * only just loaded must not move the host page. Compared by value rather than
 * by "has this effect run before", so React's development double run of
 * effects cannot turn the initial screen into a change.
 */
export function useAnnounceScreenChange(screen: string): void {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (last.current === screen) return;
    const initial = last.current === null;
    last.current = screen;
    if (!initial) announceScreenChange();
  }, [screen]);
}
