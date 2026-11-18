'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { AnnouncementCopy, AnnouncementVideo } from '@quill/shared';
import { Modal } from '@/components/modal';
import { buttonVariants } from '@/components/ui/button';
import type { ThemePref } from '@/lib/theme';
import {
  captureAnnouncementDismissed,
  captureAnnouncementSeen,
  markAnnouncementShownThisSession,
  markAnnouncementSurface,
  reportAnnouncement,
  type AnnouncementDismissVia,
} from './announcement-client';
import './announcement.css';

/**
 * The announcement pop-up: a dialog over the dashboard with the looping
 * animation on top, the title, one line, the button to the announcement's
 * route and a close button.
 *
 * Built on the shared `Modal`, portalled to <body> (so nothing in the page's
 * stacking contexts can paint over it, see lib/layers.ts), with its focus
 * trap, Escape and `aria-modal`, plus the page's scroll held still behind it.
 * Focus starts on the close button, never on the call to action, so Enter on
 * arrival does not navigate anyone away.
 *
 * Closing it in any way (the X, Escape, a click outside, or the button) ends
 * it for good: the close is stored against the person, so it does not come
 * back after a reload, in another browser, or in another workspace. When to
 * open it is the rail's call (admin-shell.tsx): once per browser session, not
 * in the builder, and never over another dialog.
 *
 * At 390px it is a sheet from the bottom, nearly the full height of the
 * screen, with the close button over the animation's corner.
 */
export function AnnouncementModal({
  open,
  onClosed,
  id,
  copy,
  cta,
  visual,
  closeLabel,
  theme,
}: {
  open: boolean;
  /** After it closed, however. The close is already reported. */
  onClosed: () => void;
  id: string;
  copy: AnnouncementCopy;
  cta: string;
  visual: AnnouncementVideo;
  /** Accessible name of the close button. */
  closeLabel: string;
  /** The theme the server painted, so the poster matches before any script runs. */
  theme: ThemePref;
}) {
  // `Modal` calls one `onClose` for Escape and for a click outside; a capture
  // listener on the window sees the key first and says which it was.
  const via = useRef<AnnouncementDismissVia | null>(null);
  useEffect(() => {
    if (!open) return;
    reportAnnouncement(id, 'seen');
    captureAnnouncementSeen(id, 'modal');
    markAnnouncementShownThisSession(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') via.current = 'escape';
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, id]);

  const close = (how: AnnouncementDismissVia) => {
    reportAnnouncement(id, 'dismissed');
    captureAnnouncementDismissed(id, how);
    via.current = null;
    onClosed();
  };

  const labelId = `announcement-${id}-title`;
  return (
    <Modal
      open={open}
      onClose={() => close(via.current ?? 'backdrop')}
      title={copy.title}
      labelId={labelId}
      portal
      bare
      lockScroll
      overlayClassName="items-end justify-center p-0 sm:items-center sm:p-6"
      panelClassName="ann-pop flex max-h-[calc(100dvh-1rem)] min-h-[88dvh] flex-col overflow-y-auto rounded-t-2xl border border-border bg-popover shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:min-h-0 sm:max-w-[640px] sm:rounded-2xl"
    >
      <div data-testid="announcement-modal" data-announcement={id} className="relative flex flex-1 flex-col">
        {/* First in the panel: `Modal` focuses the first button it finds. A
            chip, not a bare icon, so it reads over both themes of the art. */}
        {/* Sticky, so a short screen that scrolls the panel (a phone held
            sideways) never scrolls the way out off it. */}
        <div className="sticky top-0 z-10 h-0">
          <button
            type="button"
            onClick={() => close('close')}
            aria-label={closeLabel}
            title={closeLabel}
            data-testid="announcement-close"
            className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-popover/90 text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground active:scale-[0.98]"
          >
            <i aria-hidden className="pi pi-times" style={{ fontSize: 14 }} />
          </button>
        </div>
        <AnnouncementMedia visual={visual} theme={theme} className="w-full shrink-0 border-b border-border" />
        <div className="flex flex-1 flex-col p-6 sm:p-8">
          <h2 id={labelId} className="text-xl font-semibold leading-snug text-foreground sm:text-2xl">
            {copy.title}
          </h2>
          <p className="mt-2 text-muted-foreground">{copy.body}</p>
          <div className="mt-auto pt-6 sm:mt-0">
            <Link
              href={cta}
              data-testid="announcement-cta"
              onClick={() => {
                markAnnouncementSurface('modal');
                close('cta');
              }}
              className={`${buttonVariants({ variant: 'default' })} w-full sm:w-auto`}
            >
              {copy.cta}
              <i aria-hidden className="pi pi-arrow-right" style={{ fontSize: 12 }} />
            </Link>
          </div>
        </div>
      </div>
    </Modal>
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
 * The animation: the poster first (at the render's aspect ratio, so the box
 * never resizes), and the video over it once it is on screen and the browser
 * is idle, so it costs the page behind nothing. WebM
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
