'use client';

import { useState } from 'react';
import { getMessages } from '@quill/shared';
import { publishFormAction, type StaleConflict } from '@/app/admin/actions';
import { useToast } from '@/components/toast';
import { callAction, isTransportError } from '@/lib/call-action';
import { cn } from '@/lib/cn';
import type { FlushResult } from '@/lib/use-autosave';

/**
 * The editor's explicit Publish control for the draft→publish flow. Autosave
 * writes an unpublished draft; this button makes it live (POST
 * /v1/forms/:id/publish via `publishFormAction`) and shows an "Unpublished
 * changes" badge while a draft is pending.
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
}) {
  const m = getMessages(locale).admin.publish;
  const toast = useToast();
  const [publishing, setPublishing] = useState(false);
  /** `saveCount` at the moment of the last successful publish; -1 = none yet. */
  const [publishedAtCount, setPublishedAtCount] = useState(-1);

  const hasDraft =
    publishedAtCount < 0 ? initialHasDraft || saveCount > 0 : saveCount > publishedAtCount;

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
      {hasDraft && !publishing ? (
        // The full label only fits once the topbar is wide (`2xl`); below that
        // it collapses to the dot — still announced, via `sr-only`, and titled
        // for sighted users. `whitespace-nowrap` keeps the label on one line
        // rather than wrapping inside this fixed-height pill.
        <span
          title={m.unpublishedChanges}
          className="hidden h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-muted px-2.5 text-xs font-medium text-muted-foreground sm:inline-flex 2xl:px-3"
        >
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary-edge" />
          <span className="sr-only 2xl:not-sr-only">{m.unpublishedChanges}</span>
        </span>
      ) : null}
      <button
        type="button"
        onClick={publish}
        disabled={!hasDraft || publishing}
        title={hasDraft ? undefined : m.noChanges}
        className={cn(
          'inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform hover:brightness-105 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          (!hasDraft || publishing) && 'cursor-not-allowed opacity-50 hover:brightness-100 active:scale-100',
        )}
      >
        {publishing ? m.publishing : m.publish}
      </button>
    </div>
  );
}
