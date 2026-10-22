'use client';

import { useEffect } from 'react';
import type { LinkPageEvent } from '@quill/types';
import { linkPageEventFromElement } from './link-page-events';

/**
 * Measures the public link page: one `view` when it opens, one `click` per
 * button or icon, with its `link_type` (form, link or social).
 *
 * Same route as the public form's funnel events, a same-origin address that
 * never changes between deploys (`/api/public/pages/:accountCode/events`),
 * relayed by the web server to the API, which enqueues the capture. Sent with
 * `sendBeacon` so a click that leaves the page still arrives. Best-effort:
 * nothing here can stop a visitor from following a link.
 *
 * Mounted only on the public page, never in the editor's preview.
 */
export function LinkPageTracker({ accountCode }: { accountCode: string }) {
  useEffect(() => {
    const endpoint = `/api/public/pages/${encodeURIComponent(accountCode)}/events`;
    const send = (event: LinkPageEvent) => {
      try {
        const body = new Blob([JSON.stringify(event)], { type: 'application/json' });
        if (navigator.sendBeacon?.(endpoint, body)) return;
        void fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(event),
          keepalive: true,
          credentials: 'same-origin',
        }).catch(() => undefined);
      } catch {
        /* analytics never breaks the page */
      }
    };

    send({ type: 'view' });

    const onClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target.closest('[data-lp-type]') : null;
      const event = target ? linkPageEventFromElement(target) : null;
      if (event) send(event);
    };
    // Capture phase on the document: one listener for every button, and it
    // runs before the browser starts following the link.
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [accountCode]);

  return null;
}
