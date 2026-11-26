'use client';

import { useEffect, useSyncExternalStore, type RefObject } from 'react';

/**
 * The rules every looping video of the playbooks plays by, the gallery's
 * thumbnails and the animations inside a playbook alike: a loop plays only
 * while it is on screen, and at most `MAX_PLAYING` play at once across the
 * whole page, the first ones in page order. A gallery or a long playbook full
 * of loops would otherwise spend the battery of the phone it is read on. With
 * reduced motion no loop is rendered at all, only its still.
 */

/** How many loops may play at the same time, on the whole page. */
export const MAX_PLAYING = 3;

const visible = new Set<HTMLVideoElement>();
let observer: IntersectionObserver | null = null;

function sync() {
  const order = [...visible].sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
  const playing = new Set(order.slice(0, MAX_PLAYING));
  for (const v of order) {
    if (playing.has(v)) {
      if (v.paused) void v.play().catch(() => {});
    } else if (!v.paused) v.pause();
  }
}

function observe(video: HTMLVideoElement): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => {};
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const v = e.target as HTMLVideoElement;
        if (e.isIntersecting) visible.add(v);
        else {
          visible.delete(v);
          v.pause();
        }
      }
      sync();
    },
    { threshold: 0.5 },
  );
  observer.observe(video);
  return () => {
    observer?.unobserve(video);
    visible.delete(video);
    sync();
  };
}

function subscribeReducedMotion(cb: () => void): () => void {
  try {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    q.addEventListener?.('change', cb);
    return () => q.removeEventListener?.('change', cb);
  } catch {
    return () => {};
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Whether the person asked for reduced motion. The server answers yes: the
 * still is what it renders, and the loop is a client-only enhancement.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => true);
}

/** Puts this video in the page's pool of loops while `enabled`. */
export function useLoopSlot(ref: RefObject<HTMLVideoElement | null>, enabled: boolean): void {
  useEffect(() => {
    const v = ref.current;
    if (!enabled || !v) return;
    return observe(v);
  }, [ref, enabled]);
}
