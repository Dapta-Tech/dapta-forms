'use client';

import { useEffect } from 'react';
import { EMBED_SCREEN_EVENT } from '@/lib/embed-screen';

/** The form's own wrapper on an embedded render (see `page.tsx`). */
const CONTENT_SELECTOR = '.pf-embed-root';

/**
 * Mounted ONLY on `?embed=1` renders of the public form: posts the content's
 * height to the parent window whenever it changes, so the host page's
 * `embed.js` can size the iframe and the form never shows an inner scrollbar.
 *
 * The height is the form's WRAPPER, never the document. The root layout gives
 * `<body>` a `min-h-dvh`, and inside an iframe a dvh IS the iframe: the document
 * was always at least as tall as the frame already was. Measured there, the
 * height could grow and never come back down, so a one-page form that swapped
 * to its short ending kept the frame at the full form's height, with the
 * ending at the top of a tall empty block the person was scrolled past. For
 * the same reason the observer watches the wrapper: `<body>` never shrinks, so
 * watching it never fired when the content did.
 *
 * It also relays whole-screen swaps (`EMBED_SCREEN_EVENT`) as a request that
 * the host bring the frame's top into view; `embed.js` decides whether it is
 * out of view. The first screen is never announced, so loading never scrolls.
 *
 * Security posture: the messages carry a single number or nothing at all,
 * never answers, keys or identifiers, which is why `targetOrigin: '*'` is
 * acceptable here (the embedding site is by definition unknown to us). The
 * parent matches frames by `event.source`, so a message can only ever act on
 * the frame it came from.
 */
export function EmbedHeightReporter() {
  useEffect(() => {
    if (window.parent === window) return; // not embedded: nothing to report to

    const content = document.querySelector<HTMLElement>(CONTENT_SELECTOR);
    const measure = (): number => {
      if (!content) {
        return Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      }
      // The wrapper's bottom edge in document coordinates. `scrollHeight`
      // rather than the box height so content that overflows the wrapper (an
      // open dropdown near the end of the form) still fits in the frame.
      const top = content.getBoundingClientRect().top + window.scrollY;
      return Math.ceil(top + content.scrollHeight);
    };

    let raf = 0;
    const post = () => {
      raf = 0;
      window.parent.postMessage({ type: 'dapta-forms:resize', height: measure() }, '*');
    };
    // Coalesce bursts (typing shows/hides questions) into one report per frame.
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(post);
    };

    // Two frames later: the new screen has been laid out and its height sent,
    // so the host acts on the frame at its new size.
    let scrollRaf = 0;
    const onScreenChange = () => {
      cancelAnimationFrame(scrollRaf);
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = requestAnimationFrame(() => {
          scrollRaf = 0;
          post();
          window.parent.postMessage({ type: 'dapta-forms:scroll-into-view' }, '*');
        });
      });
    };

    const ro = new ResizeObserver(schedule);
    if (content) ro.observe(content);
    else {
      ro.observe(document.documentElement);
      ro.observe(document.body);
    }
    window.addEventListener('load', schedule);
    window.addEventListener(EMBED_SCREEN_EVENT, onScreenChange);
    schedule();

    return () => {
      ro.disconnect();
      window.removeEventListener('load', schedule);
      window.removeEventListener(EMBED_SCREEN_EVENT, onScreenChange);
      if (raf) cancelAnimationFrame(raf);
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
    };
  }, []);

  return null;
}
