'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { AnnouncementCopy, AnnouncementVideo } from '@quill/shared';
import { buttonVariants } from '@/components/ui/button';
import type { ThemePref } from '@/lib/theme';
import {
  captureAnnouncement,
  captureAnnouncementSeen,
  markAnnouncementSurface,
  reportAnnouncement,
} from './announcement-client';
import './announcement.css';

/**
 * The home's announcement card: a looping animation, a title, one line, a
 * button to the announcement's route and a close button. It sits at the top
 * of the home, above the "Connect your agent" banner, as one full-width row,
 * and never blocks anything: no overlay, no focus taken, no scroll lock.
 *
 * Rendered by the server with the page, so it is there on first paint and
 * nothing below it moves when it arrives. Closing it hides it at once and
 * stores the close against the person; the rail badge outlives it (see
 * `pickAnnouncement`).
 */
export function AnnouncementCard({
  id,
  copy,
  cta,
  visual,
  closeLabel,
  theme,
}: {
  id: string;
  copy: AnnouncementCopy;
  cta: string;
  visual: AnnouncementVideo;
  /** Accessible name of the close button. */
  closeLabel: string;
  /** The theme the server painted, so the poster matches before any script runs. */
  theme: ThemePref;
}) {
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    captureAnnouncementSeen(id, 'card');
  }, [id]);

  if (closed) return null;

  const dismiss = () => {
    setClosed(true);
    reportAnnouncement(id, 'dismissed');
    captureAnnouncement('dismissed', id, 'card');
  };

  return (
    <section
      aria-labelledby="announcement-title"
      data-testid="home-announcement"
      data-announcement={id}
      // `isolate`: the video and the close button are positioned layers; one
      // stacking context keeps them ranked inside the card, as in agent-card.tsx.
      className="ann-in relative isolate mb-6 overflow-hidden rounded-2xl border border-border bg-card"
    >
      <div className="flex flex-col sm:flex-row sm:items-stretch">
        <AnnouncementMedia
          visual={visual}
          theme={theme}
          className="w-full shrink-0 border-b border-border sm:w-[232px] sm:border-b-0 sm:border-r lg:w-[264px]"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-5 sm:justify-center sm:p-6 sm:pr-16 lg:flex-row lg:items-center lg:gap-8">
          <div className="min-w-0 flex-1">
            <h2 id="announcement-title" className="text-lg font-semibold leading-snug text-foreground sm:text-xl">
              {copy.title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{copy.body}</p>
          </div>
          <Link
            href={cta}
            data-testid="home-announcement-cta"
            onClick={() => markAnnouncementSurface('card')}
            className={`${buttonVariants({ variant: 'default' })} shrink-0 self-start lg:self-center`}
          >
            {copy.cta}
            <i aria-hidden className="pi pi-arrow-right" style={{ fontSize: 12 }} />
          </Link>
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={closeLabel}
        title={closeLabel}
        data-testid="home-announcement-close"
        // A chip, not a bare icon: on a phone it sits over the animation, and
        // has to read against both of its themes.
        className="absolute right-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card/90 text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground active:scale-[0.98] sm:right-3 sm:top-3 sm:h-9 sm:w-9"
      >
        <i aria-hidden className="pi pi-times" style={{ fontSize: 13 }} />
      </button>
    </section>
  );
}

/** `prefers-reduced-motion`, read after mount: the server renders the poster either way. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let query: MediaQueryList;
    try {
      query = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch {
      return;
    }
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener?.('change', sync);
    return () => query.removeEventListener?.('change', sync);
  }, []);
  return reduced;
}

/**
 * The dashboard's theme as painted on `<html data-theme>`, starting from the
 * server's and following the toggle afterwards.
 */
function useDocumentTheme(initial: ThemePref): ThemePref {
  const [theme, setTheme] = useState<ThemePref>(initial);
  useEffect(() => {
    const html = document.documentElement;
    const sync = () => setTheme(html.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
    sync();
    if (typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(sync);
    mo.observe(html, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return theme;
}

/**
 * `muted` as a PROPERTY, before playback is asked for. React renders the prop
 * but not the attribute, and Safari decides whether a video may autoplay from
 * what the element says when it is inserted; without this an iPhone can leave
 * the card on its poster.
 */
function muteAndPlay(video: HTMLVideoElement | null): void {
  if (!video) return;
  video.muted = true;
  video.defaultMuted = true;
  const played = video.play?.();
  if (played && typeof played.catch === 'function') played.catch(() => {});
}

/**
 * The animation: the poster first (server-rendered, at the render's aspect
 * ratio, so the box never resizes), and the video over it once the card is on
 * screen and the browser is idle, so it costs the home nothing at load. WebM
 * first, MP4 for Safari. Under reduced motion the video never mounts: the
 * poster is the whole visual. Decorative: the title says what it shows.
 */
export function AnnouncementMedia({
  visual,
  theme: initialTheme,
  className,
}: {
  visual: AnnouncementVideo;
  theme: ThemePref;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const theme = useDocumentTheme(initialTheme);
  const [play, setPlay] = useState(false);

  useEffect(() => {
    if (reduced) {
      setPlay(false);
      return;
    }
    const el = box.current;
    if (!el) return;
    let cancelled = false;
    let idle: number | undefined;
    const start = () => {
      if (cancelled) return;
      const ric = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
        .requestIdleCallback;
      if (ric) idle = ric(() => !cancelled && setPlay(true), { timeout: 1500 });
      else idle = window.setTimeout(() => !cancelled && setPlay(true), 200);
    };
    if (typeof IntersectionObserver === 'undefined') {
      start();
      return () => {
        cancelled = true;
      };
    }
    const io = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      io.disconnect();
      start();
    });
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
      if (idle !== undefined) {
        const cic = (window as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
        if (cic) cic(idle);
        window.clearTimeout(idle);
      }
    };
  }, [reduced]);

  const base = `${visual.src}-${theme}`;
  const poster = `${base}-poster.png`;
  return (
    <div
      ref={box}
      aria-hidden
      data-testid="announcement-media"
      data-theme-variant={theme}
      className={`ann-media relative overflow-hidden bg-panel ${className ?? ''}`}
      style={{ aspectRatio: `${visual.width} / ${visual.height}` }}
    >
      <img
        src={poster}
        alt=""
        width={visual.width}
        height={visual.height}
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />
      {play ? (
        <video
          // A new element per theme: swapping <source> children does not reload a playing video.
          key={theme}
          ref={muteAndPlay}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster={poster}
          tabIndex={-1}
          className="absolute inset-0 h-full w-full object-cover"
        >
          <source src={`${base}.webm`} type="video/webm" />
          <source src={`${base}.mp4`} type="video/mp4" />
        </video>
      ) : null}
    </div>
  );
}
