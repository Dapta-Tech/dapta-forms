'use client';

import { useRef } from 'react';
import { useLoopSlot, useReducedMotion } from './loop-video';

/**
 * A playbook card's picture: a short muted loop (webm, with an mp4 beside it
 * for Safari; rendered at 464 x 288, so the card keeps that ratio) over its
 * poster, or the poster alone, or a quiet tile in the
 * category's tint while the catalog has neither.
 *
 * The loop never loads before it is needed (`preload="none"`) and plays by
 * the rules of `loop-video.ts`: only on screen, at most `MAX_PLAYING` at once
 * on the page (the animations inside a playbook count too), and with reduced
 * motion not at all, only the poster.
 */

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
  const reduced = useReducedMotion();
  const showVideo = !!video && !reduced;
  useLoopSlot(ref, showVideo);

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
