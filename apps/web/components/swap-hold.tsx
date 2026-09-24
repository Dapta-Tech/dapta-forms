'use client';

/**
 * A keyed Suspense that does not blink when its key changes.
 *
 * The submissions table is wrapped in `<Suspense key={rows}>` (the #193 fix:
 * a boundary that keeps its key never paints the new rows), so every filter,
 * page or refresh mounts a NEW boundary, and React shows a new boundary's
 * fallback for a commit or two even when the content is already on the
 * client. The skeleton flashed for that moment, and in the full-screen sheet
 * the whole sheet went with it, down to the page behind.
 *
 * Moving the key inside a stable boundary is not an option: the router then
 * drops the navigation (the filter never applies). So the fallback keeps the
 * picture instead. `SwapHold` marks the region; `HeldFallback`, rendered as
 * the fallback, copies what the region shows while React is still rendering
 * (the old rows are on screen until the commit), and draws that copy, inert,
 * with its scroll positions, until the new content replaces it. With nothing
 * to copy (the first load, or the server) it draws its children, the skeleton.
 */
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

const RegionContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

/** The region a `HeldFallback` inside it copies. Adds no box of its own. */
export function SwapHold({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <RegionContext.Provider value={ref}>
      <div ref={ref} className="contents" data-swap-hold="">
        {children}
      </div>
    </RegionContext.Provider>
  );
}

interface Snapshot {
  html: string;
  /** Scroll offsets by element position in document order, only the scrolled ones. */
  scrolls: Array<[number, number, number]>;
}

export function capture(region: HTMLElement | null): Snapshot | null {
  if (!region || region.childElementCount === 0) return null;
  const scrolls: Snapshot['scrolls'] = [];
  region.querySelectorAll('*').forEach((el, i) => {
    if (el.scrollTop || el.scrollLeft) scrolls.push([i, el.scrollTop, el.scrollLeft]);
  });
  return { html: region.innerHTML, scrolls };
}

/** The fallback: the region as it last looked, or `children` when there is nothing to copy. */
export function HeldFallback({ children }: { children: ReactNode }) {
  const region = useContext(RegionContext);
  // Read once, during render: the commit that shows this fallback is also the
  // one that removes the old content, so later would be too late.
  const [snapshot] = useState(() => capture(region?.current ?? null));
  const copy = useRef<HTMLDivElement>(null);

  // Before paint, so the copy never shows at the top of a table that was scrolled.
  useLayoutEffect(() => {
    if (!snapshot || !copy.current) return;
    const all = copy.current.querySelectorAll('*');
    for (const [i, top, left] of snapshot.scrolls) {
      const el = all[i];
      if (el) {
        el.scrollTop = top;
        el.scrollLeft = left;
      }
    }
  }, [snapshot]);

  if (!snapshot) return <>{children}</>;
  return (
    <div
      ref={copy}
      // Fresh nodes would replay every entrance animation they carry (the
      // sheet's fade-in dimmed the screen for a moment): a copy holds still.
      className="contents [&_*]:animate-none!"
      inert
      aria-hidden
      data-testid="held-fallback"
      dangerouslySetInnerHTML={{ __html: snapshot.html }}
    />
  );
}
