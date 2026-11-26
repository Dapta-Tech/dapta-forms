'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * A playbook card's picture: a short muted loop (webm, with an mp4 beside it
 * for Safari) over its poster, or the poster alone, or a quiet tile in the
 * category's tint while the catalog has neither.
 *
 * The loop never loads before it is needed (`preload="none"`), plays only
 * while the card is on screen, and at most `MAX_PLAYING` play at once, the
 * first ones in page order: a gallery of nine looping videos would spend the
 * battery of the phone it is read on. With reduced motion the video is not
 * rendered at all, only the poster.
 */

/** How many loops may play at the same time. */
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

/** The mp4 beside a webm loop (`/playbooks/x.webm` → `/playbooks/x.mp4`), or null. */
export function mp4Sibling(src: string): string | null {
  return /\.webm(\?.*)?$/i.test(src) ? src.replace(/\.webm(\?.*)?$/i, '.mp4$1') : null;
}

/** The tint of the placeholder tile, per category. */
const TINT: Record<string, string> = {
  ventas: 'bg-signal/15 text-signal-ink',
  marketing: 'bg-score/15 text-score-ink',
  ads: 'bg-warning/15 text-warning-ink',
  agentes: 'bg-brand-ink text-brand-ink-foreground',
};

const ICON: Record<string, string> = {
  ventas: 'pi-chart-line',
  marketing: 'pi-megaphone',
  ads: 'pi-bolt',
  agentes: 'pi-bot',
};

export function PlaybookThumb({
  video,
  poster,
  category,
  className = '',
}: {
  video: string | null;
  poster: string | null;
  category: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  // The server renders the poster: the loop is a client-only enhancement.
  const reduced = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => true);
  const showVideo = !!video && !reduced;

  useEffect(() => {
    const v = ref.current;
    if (!showVideo || !v) return;
    return observe(v);
  }, [showVideo]);

  const frame = `relative overflow-hidden ${className}`;
  if (showVideo) {
    const mp4 = mp4Sibling(video);
    return (
      <div className={frame}>
        <video
          ref={ref}
          muted
          loop
          playsInline
          preload="none"
          poster={poster ?? undefined}
          aria-hidden
          tabIndex={-1}
          data-testid="playbook-thumb-video"
          className="absolute inset-0 h-full w-full object-cover"
        >
          <source src={video} type={/\.mp4(\?.*)?$/i.test(video) ? 'video/mp4' : 'video/webm'} />
          {mp4 ? <source src={mp4} type="video/mp4" /> : null}
        </video>
      </div>
    );
  }
  if (poster) {
    return (
      <div className={frame}>
        {/* Decorative: the card's title names it. */}
        <img src={poster} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      </div>
    );
  }
  return (
    <div
      aria-hidden
      data-testid="playbook-thumb-placeholder"
      className={`${frame} flex items-center justify-center ${TINT[category] ?? 'bg-muted text-muted-foreground'}`}
    >
      <i className={`pi ${ICON[category] ?? 'pi-book-check'}`} style={{ fontSize: 36 }} />
    </div>
  );
}
