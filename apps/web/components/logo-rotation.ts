'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * How long each logo of a rail carousel stays before the next one fades in:
 * the same for every logo, on one steady interval (the crossfade is symmetric
 * and short, so no logo reads as staying longer than the others).
 */
export const LOGO_ROTATE_MS = 1600;

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.(REDUCED_MOTION).matches;
  } catch {
    return false;
  }
}

/**
 * Which of `count` stacked logos is showing. Shared by every rail item whose
 * icon is a set of logos taking turns ("Connect your agent", "Integrations"),
 * so they rotate, pause and hold still by one rule:
 *
 *  - starts on the first logo on the server and on the client alike, so
 *    hydration agrees;
 *  - stops while `paused` (the pointer is on the row: nobody should have to
 *    chase the target they are reading);
 *  - never starts under `prefers-reduced-motion`, read after mount (the server
 *    cannot know it) and followed if it changes while the page is open. The
 *    first logo is then the static icon.
 *
 * `delayMs` shifts the very first change only, so two carousels stacked in
 * the rail take turns instead of swapping on the same frame. Resuming after a
 * hover waits one plain interval: the offset is not paid again.
 */
export function useLogoRotation(
  count: number,
  { paused = false, delayMs = 0 }: { paused?: boolean; delayMs?: number } = {},
): number {
  const [index, setIndex] = useState(0);
  const [still, setStill] = useState(true);
  const offset = useRef(delayMs);

  useEffect(() => {
    setStill(prefersReducedMotion());
    let query: MediaQueryList | undefined;
    try {
      query = window.matchMedia?.(REDUCED_MOTION);
    } catch {
      query = undefined;
    }
    if (!query?.addEventListener) return;
    const onChange = (e: MediaQueryListEvent) => setStill(e.matches);
    query.addEventListener('change', onChange);
    return () => query?.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (still || paused || count < 2) return;
    const next = () => setIndex((i) => (i + 1) % count);
    let timer: ReturnType<typeof setInterval> | undefined;
    const first = setTimeout(() => {
      offset.current = 0;
      next();
      timer = setInterval(next, LOGO_ROTATE_MS);
    }, LOGO_ROTATE_MS + offset.current);
    return () => {
      clearTimeout(first);
      if (timer) clearInterval(timer);
    };
  }, [still, paused, count]);

  return index;
}
