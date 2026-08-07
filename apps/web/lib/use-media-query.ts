'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Subscribe to a CSS media query from React.
 *
 * `useSyncExternalStore` rather than `useState` + an effect because the server
 * has no viewport: the third argument is the SSR snapshot, so the first client
 * render matches the server's exactly and React never warns about a hydration
 * mismatch. It also means a component can branch on the query without the
 * one-frame flash an effect-based hook always produces.
 *
 * Use this only when the two branches are genuinely different COMPONENTS. If
 * the difference is presentational, a CSS breakpoint is cheaper and keeps
 * working with JS disabled.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  // `subscribe` is memoised because `useSyncExternalStore` re-subscribes
  // whenever its identity changes: a fresh arrow per render tore down and
  // rebuilt the `MediaQueryList` listener on EVERY render of the component
  // above — in the builder, every keystroke. Only `query` can change it.
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** Tailwind's `lg` breakpoint — where the builder gains its three-pane shell. */
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
