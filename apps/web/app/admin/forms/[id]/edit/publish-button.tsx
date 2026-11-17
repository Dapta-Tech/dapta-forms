'use client';

import { useEffect, useRef, useState } from 'react';
import { getMessages, t } from '@quill/shared';
import {
  publishFormAction,
  revertFormAction,
  type RevertFormResult,
  type StaleConflict,
} from '@/app/admin/actions';
import { useToast } from '@/components/toast';
import { AnchoredMenu } from '@/components/ui/anchored-menu';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { callAction, isTransportError } from '@/lib/call-action';
import { cn } from '@/lib/cn';
import type { FlushResult } from '@/lib/use-autosave';

/**
 * What both halves of the Publish pill share. They are transparent: the pill's
 * fill lives on the wrapper, so a half can only tint itself, never drift. Focus
 * is an INSET ring in the label's colour (ink on the green, 9.7:1): the app's
 * default ring sits 2px outside the element, where the other half paints over
 * it and leaves it open at the seam. `!` because that default is an unlayered
 * `:focus-visible` rule in globals.css, which outranks any layered utility
 * (leading `!`: tailwind-merge v2 does not parse the trailing form).
 */
const SEGMENT =
  'inline-flex shrink-0 items-center justify-center text-inherit transition-colors focus-visible:!outline-current focus-visible:!-outline-offset-4';

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
 *
 * Beside it, a chevron opens the publish menu, which holds one action today:
 * "Revert to the previous published version". Publishing directly is safe
 * because it can be undone in one click, by API or from here. The item shows
 * when the version it brings back went live, is disabled while there is none
 * (`initialPreviousPublishedAt` null, then whatever each publish or revert
 * answers), and asks first in a dialog that names that date and says the
 * draft does not change. Pending autosave edits are flushed before the call,
 * for the same reason Publish flushes: so they land in the draft, which the
 * revert leaves alone, rather than being lost when the editor reloads the
 * live version it now serves.
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
  initialPreviousPublishedAt = null,
  onReverted,
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
  /** When the version a revert would bring back went live, from the loaded row; null = none. */
  initialPreviousPublishedAt?: number | null;
  /** A revert landed: the row's new stamp, what the server now holds, and whether a draft is pending. */
  onReverted?: (res: Extract<RevertFormResult, { ok: true }>) => void;
}) {
  const m = getMessages(locale).admin.publish;
  const toast = useToast();
  const [publishing, setPublishing] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** When the version a revert would bring back went live; null = nothing to revert to. */
  const [previousAt, setPreviousAt] = useState<number | null>(initialPreviousPublishedAt);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const { confirm, dialog } = useConfirmDialog();
  const busy = publishing || reverting;
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
    if (!hasDraft || busy) return;
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
        setPreviousAt(res.previousPublishedAt);
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

  /** The date a version went live, in the reader's language and clock. */
  const when = (ms: number) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(ms);

  async function revert() {
    setMenuOpen(false);
    if (previousAt == null || busy) return;
    const date = when(previousAt);
    const accepted = await confirm({
      title: m.revertTitle,
      message: t(m.revertBody, { date }),
      confirmLabel: m.revertConfirm,
    });
    if (!accepted) return;
    setReverting(true);
    try {
      if (flush) {
        const flushed = await flush();
        if (!flushed.ok) {
          if (flushed.kind !== 'conflict') toast.error(m.revertSaveFirst);
          return;
        }
      }
      const res = await callAction(() => revertFormAction(formId));
      if (isTransportError(res)) {
        toast.error(m.revertError);
      } else if (res.ok) {
        setPreviousAt(res.previousPublishedAt);
        onReverted?.(res);
        toast.success(m.reverted);
      } else if (res.code === 'NOTHING_TO_REVERT') {
        // Someone else's revert or a stale page: the control follows the server.
        setPreviousAt(null);
        toast.error(m.nothingToRevert);
      } else {
        toast.error(res.message ?? m.revertError);
      }
    } finally {
      setReverting(false);
    }
  }

  const canRevert = previousAt != null && !busy;
  /** Nothing to publish and nothing in flight: the whole pill goes quiet. */
  const idle = !hasDraft && !busy;

  return (
    // ONE pill, two buttons. The fill, the rim (`.bg-signal` in globals.css)
    // and the radius live on this wrapper only, so the halves can never
    // disagree: before, each half carried its own fill, its own rim and its own
    // disabled opacity, which drew a doubled rim plus a border at the seam and
    // a pale Publish beside a solid chevron. The halves are transparent and
    // only tint themselves on hover, press and open.
    <div
      data-tour="publish"
      data-testid="publish-control"
      data-state={busy ? 'busy' : idle ? 'idle' : 'pending'}
      className={cn(
        'inline-flex h-9 shrink-0 items-stretch rounded-full text-sm font-semibold',
        idle
          ? 'bg-muted text-muted-foreground shadow-[inset_0_0_0_1px_var(--input)]'
          : 'bg-signal text-signal-foreground',
      )}
    >
      <button
        type="button"
        onClick={publish}
        disabled={!hasDraft || busy}
        aria-busy={busy || undefined}
        title={hasDraft ? undefined : m.noChanges}
        data-testid="publish-button"
        className={cn(
          SEGMENT,
          'gap-2 whitespace-nowrap rounded-l-full pl-4 pr-3',
          busy
            ? 'cursor-progress'
            : idle
              ? 'cursor-not-allowed'
              : 'hover:bg-signal-foreground/10 active:bg-signal-foreground/20',
        )}
      >
        {busy ? <i aria-hidden className="pi pi-spin pi-spinner" style={{ fontSize: 13 }} /> : null}
        {publishing ? m.publishing : reverting ? m.reverting : m.publish}
      </button>
      {/* The seam: a hairline inset from the rim, in the label's own colour. */}
      <span aria-hidden data-testid="publish-divider" className="my-2 w-px shrink-0 bg-current opacity-30" />
      {/* The publish menu. Its own half of the pill, never disabled: what it
          holds is useful exactly when there is nothing new to publish. */}
      <button
        ref={menuButtonRef}
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={m.moreOptions}
        title={m.moreOptions}
        data-testid="publish-menu-button"
        className={cn(
          SEGMENT,
          'w-8 rounded-r-full',
          idle
            ? 'hover:bg-foreground/10 active:bg-foreground/15 aria-expanded:bg-foreground/15'
            : 'hover:bg-signal-foreground/10 active:bg-signal-foreground/20 aria-expanded:bg-signal-foreground/15',
        )}
      >
        <i aria-hidden className="pi pi-chevron-down" style={{ fontSize: 11 }} />
      </button>
      <AnchoredMenu
        anchorRef={menuButtonRef}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        label={m.moreOptions}
        width={288}
        autoFocus
        className="p-1.5"
        testId="publish-menu"
      >
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          // aria-disabled, not `disabled`: the item stays focusable, so a
          // keyboard or screen reader user lands on it and hears why it is
          // off (the hint below) instead of on an empty menu.
          aria-disabled={!canRevert}
          onClick={() => {
            if (canRevert) void revert();
          }}
          data-testid="publish-menu-revert"
          className="flex w-full items-start gap-2.5 rounded-sm px-2 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-inherit"
        >
          <i aria-hidden className="pi pi-history mt-0.5 text-muted-foreground" style={{ fontSize: 13 }} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span>{m.revert}</span>
            <span className="text-xs text-muted-foreground" data-testid="publish-menu-revert-hint">
              {previousAt != null ? t(m.revertAvailable, { date: when(previousAt) }) : m.revertUnavailable}
            </span>
          </span>
        </button>
      </AnchoredMenu>
      {dialog}
    </div>
  );
}
