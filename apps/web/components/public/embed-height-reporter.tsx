'use client';

import { useEffect } from 'react';

/**
 * Mounted ONLY on `?embed=1` renders of the public form: posts the document's
 * content height to the parent window whenever it changes, so the host page's
 * `embed.js` can size the iframe and the form never shows an inner scrollbar.
 *
 * Security posture: the message carries a single number — never answers, keys
 * or identifiers — which is why `targetOrigin: '*'` is acceptable here (the
 * embedding site is by definition unknown to us). The parent matches frames by
 * `event.source`, so the number can only ever size the frame it came from.
 */
export function EmbedHeightReporter() {
  useEffect(() => {
    if (window.parent === window) return; // not embedded — nothing to report to

    let raf = 0;
    const post = () => {
      raf = 0;
      const height = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      );
      window.parent.postMessage({ type: 'dapta-forms:resize', height }, '*');
    };
    // Coalesce bursts (typing shows/hides questions) into one report per frame.
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(post);
    };

    const ro = new ResizeObserver(schedule);
    ro.observe(document.documentElement);
    ro.observe(document.body);
    window.addEventListener('load', schedule);
    schedule();

    return () => {
      ro.disconnect();
      window.removeEventListener('load', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return null;
}
