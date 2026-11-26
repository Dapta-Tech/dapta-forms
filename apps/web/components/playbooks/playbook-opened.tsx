'use client';

import { useEffect, useRef } from 'react';
import { recordPlaybookSeenAction } from '@/app/admin/playbook-actions';
import { callAction } from '@/lib/call-action';
import { captureEvent } from '@/lib/product-analytics';

/**
 * Records that the person opened a playbook, once the reader is on screen:
 * the API stores the open (`POST /v1/me/playbooks/:slug/seen`, which also
 * emits the server's `forms_playbook_viewed`), and the client emits
 * `forms_playbook_opened` for the funnel. Draws nothing.
 */
export function PlaybookOpened({ slug, category }: { slug: string; category: string }) {
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (done.current === slug) return;
    done.current = slug;
    void callAction(() => recordPlaybookSeenAction(slug));
    captureEvent('playbook_opened', { slug, category });
  }, [slug, category]);
  return null;
}
