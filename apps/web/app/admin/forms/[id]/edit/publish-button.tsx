'use client';

import { useState } from 'react';
import { getMessages } from '@quill/shared';
import { publishFormAction } from '@/app/admin/actions';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';

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
 * The button disables itself when there is nothing to publish.
 */
export function PublishButton({
  formId,
  initialHasDraft = false,
  saveCount = 0,
  locale,
}: {
  formId: string;
  initialHasDraft?: boolean;
  saveCount?: number;
  locale: string;
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
    // Snapshot BEFORE the round-trip: a save landing mid-publish wrote a draft
    // the publish may not have carried, so the badge must come back for it.
    const snapshot = saveCount;
    const res = await publishFormAction(formId);
    setPublishing(false);
    if (res.ok) {
      setPublishedAtCount(snapshot);
      toast.success(m.published);
    } else {
      toast.error(res.message ?? m.publishError);
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
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
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
