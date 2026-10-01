'use client';

import { useEffect, useRef, useState } from 'react';
import { getMessages } from '@quill/shared';
import { publishFormAction, type StaleConflict } from '@/app/admin/actions';
import { useToast } from '@/components/toast';
import { callAction, isTransportError } from '@/lib/call-action';
import { cn } from '@/lib/cn';
import type { FlushResult } from '@/lib/use-autosave';

/**
 * The editor's explicit Publish control for the draft→publish flow. Autosave
 * writes an unpublished draft; this button makes it live (POST
 * /v1/forms/:id/publish via `publishFormAction`) and reports, through
 * `onPendingChange`, whether a draft is pending. The editor draws the
 * "Unpublished changes" badge from that, beside the form's name: the state
 * belongs to the form, and the name is where the form is.
 *
 * Draft-state contract (kept self-contained so the editor's patch stays small):
 * - `initialHasDraft` — whether the server row already had a `draftConfig`
 *   when the page loaded.
 * - `saveCount` — increment on every SUCCESSFUL autosave; each save writes a
 *   fresh draft, so any save after the last publish means "unpublished changes".
 * - `flush` — the editor's autosave flush. Publish AWAITS it before calling the
 *   API: the API publishes the draft the SERVER holds, so a debounced edit
 *   (typed a redirect, pressed Publish in the same gesture) would otherwise be
 *   left out of the published config and land as a fresh draft right after.
 * The button disables itself when there is nothing to publish.
 */
export function PublishButton({
  formId,
  initialHasDraft = false,
  saveCount = 0,
  locale,
  flush,
  getSaveCount,
  getStamp,
  onPublished,
  onStale,
  onPendingChange,
}: {
  formId: string;
  initialHasDraft?: boolean;
  saveCount?: number;
  locale: string;
  /** Push pending autosave edits to the server first; a failure cancels the publish. */
  flush?: () => Promise<FlushResult>;
  /** `saveCount` read fresh AFTER the flush (the prop is the value at render). */
  getSaveCount?: () => number;
  /** The editor's optimistic-lock stamp at click time (undefined = unguarded). */
  getStamp?: () => number | undefined;
  /** A publish landed: the row's new stamp and the content the server now holds. */
  onPublished?: (updatedAt: number, saved: { name: string; config: unknown }) => void;
  /** The server refused the publish as STALE. `retry` = only the stamp moved
   *  and the editor adopted the new one; `stop` = a real conflict, shown by the editor. */
  onStale?: (res: StaleConflict) => 'retry' | 'stop';
  /** Whether there are unpublished changes to show a badge for (false while a publish is in flight). */
  onPendingChange?: (pending: boolean) => void;
}) {
  const m = getMessages(locale).admin.publish;
  const toast = useToast();
  const [publishing, setPublishing] = useState(false);
  /** `saveCount` at the moment of the last successful publish; -1 = none yet. */
  const [publishedAtCount, setPublishedAtCount] = useState(-1);

  const hasDraft =
    publishedAtCount < 0 ? initialHasDraft || saveCount > 0 : saveCount > publishedAtCount;

  const pending = hasDraft && !publishing;
  // Through a ref, so a caller passing an inline arrow does not re-fire this on
  // every one of its own renders: only a real change of state is reported.
  const reportPending = useRef(onPendingChange);
  reportPending.current = onPendingChange;
  useEffect(() => {
    reportPending.current?.(pending);
  }, [pending]);

  async function publish() {
    if (!hasDraft || publishing) return;
    setPublishing(true);
    try {
      if (flush) {
        const flushed = await flush();
        if (!flushed.ok) {
          // Nothing published: the server does not hold what is on screen.
          // A conflict has the editor's banner; anything else gets told here
          // (the autosave toast only fires once per outage, so a click that
          // hits the same outage would otherwise go silent).
          if (flushed.kind !== 'conflict') toast.error(m.saveFirst);
          return;
        }
      }
      // Snapshot AFTER the flush and BEFORE the round-trip: a save landing
      // mid-publish wrote a draft the publish may not have carried, so the
      // badge must come back for it.
      const snapshot = getSaveCount?.() ?? saveCount;
      // Transport-safe: a rejected invocation (network drop, deploy-rotated
      // action id) must re-enable the button, not strand it on "Publishing…".
      let res = await callAction(() => publishFormAction(formId, getStamp?.()));
      // One silent retry when only the stamp moved (the editor decides that).
      if (!isTransportError(res) && !res.ok && 'conflict' in res && onStale?.(res) === 'retry') {
        res = await callAction(() => publishFormAction(formId, getStamp?.()));
      }
      if (res.ok) {
        setPublishedAtCount(snapshot);
        onPublished?.(res.updatedAt, res.saved);
        toast.success(m.published);
      } else if (!isTransportError(res) && 'conflict' in res) {
        // The editor's banner owns this one; the button just comes back.
      } else {
        toast.error((isTransportError(res) ? null : res.message) ?? m.publishError);
      }
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2" data-tour="publish">
      <button
        type="button"
        onClick={publish}
        disabled={!hasDraft || publishing}
        title={hasDraft ? undefined : m.noChanges}
        className={cn(
          'inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full bg-signal px-4 text-sm font-semibold text-signal-foreground transition-transform hover:brightness-105 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          (!hasDraft || publishing) && 'cursor-not-allowed opacity-50 hover:brightness-100 active:scale-100',
        )}
      >
        {publishing ? m.publishing : m.publish}
      </button>
    </div>
  );
}
