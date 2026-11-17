'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
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
import type { AutosaveStatus, FlushResult } from '@/lib/use-autosave';

/**
 * What both halves of the Publish pill share. They are transparent: the pill's
 * fill lives on the wrapper, so a half can only tint itself, never drift.
 *
 * Focus is a capsule drawn INSIDE the focused half (`after:`, inset 3px, fully
 * rounded, 2px in the label's colour: ink on the green, 9.7:1), so both halves
 * get the same shape and neither ring is cut square at the divider or covered
 * by the other half. The app's default ring is an unlayered `:focus-visible`
 * outline 2px OUTSIDE the element, which outranks any layered utility, hence
 * `!outline-hidden` (leading `!`: tailwind-merge v2 does not parse the
 * trailing form). `outline-hidden` keeps a real outline for forced colours.
 */
const SEGMENT =
  "relative inline-flex shrink-0 items-center justify-center text-inherit transition-colors focus-visible:!outline-hidden after:pointer-events-none after:absolute after:inset-[3px] after:rounded-full after:content-[''] focus-visible:after:shadow-[inset_0_0_0_2px_currentColor]";

type LabelKey = 'publish' | 'published' | 'saving' | 'publishing' | 'reverting';

/**
 * How the reason under a blocked Publish came to be showing, because each way
 * in has its own way out: `hover` leaves with the pointer, `focus` with the
 * focus, and `press` (a tap: no hover to end, and on iOS no focus either) on
 * the next pointer down elsewhere, on a scroll, or by itself after a moment.
 */
type ReasonOpen = false | 'hover' | 'focus' | 'press';
/** How long a reason opened by a press stays up on its own. */
const REASON_PRESS_MS = 4000;
/** The least the reason keeps clear of the viewport's edges. */
const REASON_EDGE_PX = 8;

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
 * - `saveStatus` is the save state of the form's DRAFT: the builder's own
 *   autosave, nothing else. A draft only exists once a save LANDS, so between
 *   an edit and its save the server has no draft yet: without this the pill
 *   went on saying "Published" over unsaved edits, indefinitely with the API
 *   down, and below 1280px (where the top bar's indicator is hidden) that was
 *   the only signal on screen. It is deliberately NOT the combined state the
 *   top bar shows: integrations are saved straight to the live form and are
 *   never part of the draft Publish publishes, so a webhook left without a URL
 *   (a standing `partial`) or a lost integrations save must not hold the pill
 *   on "Publish" after a publish that did go through.
 * - `hasQuestions` is whether the form has anything to answer. A form with no
 *   questions is served by its link like any other, but there is nothing in it
 *   to call published, and the save indicator beside the pill reads "Draft".
 * The button disables itself when there is nothing to publish.
 *
 * What the main half says, in order:
 *   publishing / reverting   in flight
 *   "Publish", pressable     a draft is pending (pressing it flushes first)
 *   "Saving…", spinner       no draft yet and an edit is on its way
 *   "Publish", blocked       no draft yet and the save is being retried, has
 *                            failed or hit a conflict; or no questions
 *   "Published"              no draft, the draft's save is clean, and there
 *                            is a form
 * A blocked main half is `aria-disabled`, never natively `disabled`: it stays
 * focusable and hoverable, so the reason it carries (its accessible
 * description, and the tooltip under it) can be reached with a keyboard, a
 * pointer or a tap. This is how the builder's other blocked controls do it.
 * "Published" does not wait for a first press of Publish: a form's config is
 * live from the moment it is created (the public link serves it, and a revert
 * dates that first version by its creation), so a form that was never published
 * through the draft flow is as live as one that was.
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
  saveStatus = 'saved',
  hasQuestions = true,
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
  /** The form draft's own save state (the builder's autosave); anything but `saved` is not clean. */
  saveStatus?: AutosaveStatus;
  /** Whether the form has at least one question. */
  hasQuestions?: boolean;
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
  const messages = getMessages(locale);
  const m = messages.admin.publish;
  const toast = useToast();
  const [publishing, setPublishing] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** When the version a revert would bring back went live; null = nothing to revert to. */
  const [previousAt, setPreviousAt] = useState<number | null>(initialPreviousPublishedAt);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const reasonId = useId();
  /** Whether the reason under a blocked Publish is showing, and what opened it. */
  const [reasonOpen, setReasonOpen] = useState<ReasonOpen>(false);
  /** Bumped by every press that shows the reason, so each one restarts its timer. */
  const [reasonPress, setReasonPress] = useState(0);
  /** Measured each time it opens: how far below the pill it hangs, and how far it is nudged right. */
  const [reasonPlace, setReasonPlace] = useState({ drop: 0, shift: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLSpanElement>(null);
  /** What the last pointer down on the main half was: `mouse`, `touch` or `pen`. */
  const lastPointer = useRef<string | null>(null);
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

  // Escape puts the reason away whenever it is showing, wherever the focus is:
  // opened by hover alone, the button never had it.
  useEffect(() => {
    if (!reasonOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setReasonOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [reasonOpen]);

  // Opened by a press, nothing else will close it: a tap leaves no hover to
  // end, and iOS Safari does not focus a button on tap, so there is no blur
  // either. So: the next pointer down anywhere but the button, any scroll, or
  // a few seconds, whichever comes first.
  useEffect(() => {
    if (reasonOpen !== 'press') return;
    const close = () => setReasonOpen(false);
    const onDown = (e: Event) => {
      if (!mainRef.current?.contains(e.target as Node)) close();
    };
    const timer = window.setTimeout(close, REASON_PRESS_MS);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', close, { capture: true, passive: true });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', close, { capture: true });
    };
  }, [reasonOpen, reasonPress]);

  const canRevert = previousAt != null && !busy;
  /**
   * What the pill is saying. With no draft on the server yet: `saving` while
   * an edit is on its way, `unsaved` when that save is being retried, failed
   * or hit a conflict. `empty`: nothing unsaved, but no questions either.
   * `idle`: the only state that reads "Published".
   */
  const state: 'busy' | 'pending' | 'saving' | 'unsaved' | 'empty' | 'idle' = busy
    ? 'busy'
    : hasDraft
      ? 'pending'
      : saveStatus === 'saving'
        ? 'saving'
        : saveStatus !== 'saved'
          ? 'unsaved'
          : hasQuestions
            ? 'idle'
            : 'empty';
  const idle = state === 'idle';
  /** Pressing the main half does nothing in every state but `pending`. */
  const blocked = state !== 'pending';
  /** Why, as a sentence: the main half's description and its tooltip. None while publishing (the label says it). */
  const reason =
    state === 'idle'
      ? m.noChanges
      : state === 'saving'
        ? m.blockedSaving
        : state === 'empty'
          ? m.blockedEmpty
          : state === 'unsaved'
            ? saveStatus === 'conflict'
              ? m.blockedConflict
              : saveStatus === 'retrying'
                ? m.blockedRetrying
                : m.blockedSaveFailed
            : null;
  const current: LabelKey = publishing
    ? 'publishing'
    : reverting
      ? 'reverting'
      : idle
        ? 'published'
        : state === 'saving'
          ? 'saving'
          : 'publish';
  // Where the reason goes, measured rather than assumed. Under the pill by
  // default. When the top bar has more below the pill's row (it wraps into two
  // rows below `lg`, tools on the second), it hangs under the WHOLE bar instead,
  // so it never lies over Preview and the link tools. And it is nudged right if
  // its left edge would leave the viewport.
  const hasReason = reason != null;
  useLayoutEffect(() => {
    if (!reasonOpen || !hasReason) return;
    const measure = () => {
      const wrap = wrapperRef.current;
      const tip = reasonRef.current;
      if (!wrap || !tip) return;
      const pill = wrap.getBoundingClientRect();
      const bar = wrap.closest('header');
      const below = bar ? bar.getBoundingClientRect().bottom - pill.bottom : 0;
      const drop = below >= pill.height / 2 ? below : 0;
      // The tip is right-aligned to the pill, so its left edge is known without
      // reading back a position this effect may itself have shifted.
      const left = pill.right - tip.getBoundingClientRect().width;
      const shift = Math.max(0, REASON_EDGE_PX - left);
      setReasonPlace((prev) => (prev.drop === drop && prev.shift === shift ? prev : { drop, shift }));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [reasonOpen, hasReason]);

  // Every label the main half can show, stacked in one grid cell so the half is
  // always as wide as the widest of them: the pill never resizes (and shifts the
  // topbar) when it flips between states. Only the current one is visible, and
  // only it is read out. "Published" is the forms list's status word, so the
  // list and the editor name the state the same way.
  const labels: { key: LabelKey; text: string; icon?: string }[] = [
    { key: 'publish', text: m.publish },
    { key: 'published', text: messages.admin.forms.statusLive, icon: 'pi pi-check' },
    { key: 'saving', text: m.saving, icon: 'pi pi-spinner' },
    { key: 'publishing', text: m.publishing, icon: 'pi pi-spinner' },
    { key: 'reverting', text: m.reverting, icon: 'pi pi-spinner' },
  ];

  return (
    // ONE pill, two buttons. The fill, the rim and the radius live on this
    // wrapper only, so the halves can never disagree: before, each half carried
    // its own fill, its own rim and its own disabled opacity, which drew a
    // doubled rim plus a border at the seam and a pale Publish beside a solid
    // chevron. The halves are transparent and only tint themselves on hover,
    // press and open. Pending (and in flight) is solid Signal Green with its
    // `.bg-signal` rim; with nothing to publish it is a solid surface with a
    // green rim and a check, a status rather than a faded button. The confirm
    // dialog is a sibling, NOT a child: inside the wrapper it inherited
    // `font-semibold` and set its body text at 600.
    <>
      <div
        ref={wrapperRef}
        data-tour="publish"
        data-testid="publish-control"
        data-state={state}
        className={cn(
          'relative inline-flex h-9 shrink-0 items-stretch rounded-full text-sm font-semibold',
          idle
            ? 'bg-card text-foreground shadow-[inset_0_0_0_1px_var(--signal-edge)]'
            : 'bg-signal text-signal-foreground',
        )}
      >
        <button
          type="button"
          // Pressing a blocked Publish shows why instead of doing nothing: on a
          // touch screen there is no hover and no keyboard focus to do it.
          ref={mainRef}
          onPointerDown={(e) => {
            lastPointer.current = e.pointerType;
          }}
          onClick={() => {
            if (blocked) {
              if (reason == null) return;
              // Already showing for a reason that ends by itself (the keyboard's
              // focus, a mouse that is still over it): leave it be. Anything
              // else is a press, with its own ways out.
              setReasonOpen((open) =>
                open === 'focus' || (open === 'hover' && lastPointer.current === 'mouse') ? open : 'press',
              );
              setReasonPress((n) => n + 1);
              return;
            }
            setReasonOpen(false);
            void publish();
          }}
          aria-disabled={blocked || undefined}
          aria-busy={busy || undefined}
          aria-describedby={reason ? reasonId : undefined}
          onMouseEnter={() => setReasonOpen((open) => open || 'hover')}
          onMouseLeave={() => setReasonOpen(false)}
          onFocus={(e) => {
            // Keyboard focus only: a click focuses too, and has its own branch above.
            if (e.currentTarget.matches(':focus-visible')) setReasonOpen('focus');
          }}
          onBlur={() => setReasonOpen(false)}
          data-testid="publish-button"
          className={cn(
            SEGMENT,
            'whitespace-nowrap rounded-l-full pl-4 pr-3',
            state === 'busy' || state === 'saving'
              ? 'cursor-progress'
              : state === 'idle'
                ? 'cursor-default'
                : state === 'pending'
                  ? 'hover:bg-signal-foreground/10 active:bg-signal-foreground/20'
                  : 'cursor-not-allowed',
          )}
        >
          <span className="grid">
            {labels.map((l) => {
              const on = l.key === current;
              return (
                <span
                  key={l.key}
                  data-label={l.key}
                  data-current={on || undefined}
                  aria-hidden={on ? undefined : true}
                  className={cn(
                    'col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5',
                    !on && 'invisible',
                  )}
                >
                  {l.icon ? (
                    <i
                      aria-hidden
                      className={cn(
                        l.icon,
                        on && l.icon.includes('spinner') && 'pi-spin',
                        l.key === 'published' && 'text-signal-ink',
                      )}
                      style={{ fontSize: 13 }}
                    />
                  ) : null}
                  {l.text}
                </span>
              );
            })}
          </span>
        </button>
        {/* The seam: a hairline inset from the rim, in the label's colour on the
            green and in the rim's colour on the published surface. */}
        <span
          aria-hidden
          data-testid="publish-divider"
          className={cn('my-2 w-px shrink-0', idle ? 'bg-signal-edge' : 'bg-current opacity-30')}
        />
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
              ? 'hover:bg-foreground/5 active:bg-foreground/10 aria-expanded:bg-foreground/10'
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
        {/* Why the main half cannot be pressed. ALWAYS in the tree while there
            is a reason, so a screen reader has the description the moment the
            button takes focus; drawn as a tooltip only on hover, keyboard
            focus or a press. Its own weight and colours: it sits inside the
            pill, which is semibold and may be green. `pointer-events-none`:
            it is something to read, and whatever lies under it (on a phone,
            the first thing below the top bar) must still take the tap. */}
        {reason ? (
          <span
            ref={reasonRef}
            id={reasonId}
            role="tooltip"
            data-testid="publish-reason"
            data-open={reasonOpen ? 'true' : undefined}
            data-opened-by={reasonOpen || undefined}
            style={
              reasonOpen
                ? {
                    top: `calc(100% + ${reasonPlace.drop}px)`,
                    transform: reasonPlace.shift ? `translateX(${reasonPlace.shift}px)` : undefined,
                  }
                : undefined
            }
            className={
              reasonOpen
                ? 'pointer-events-none absolute right-0 z-50 mt-1.5 w-56 max-w-[calc(100vw-1rem)] whitespace-normal rounded-md border border-border bg-popover px-2.5 py-2 text-left text-xs font-normal leading-relaxed text-popover-foreground shadow-lg'
                : 'sr-only'
            }
          >
            {reason}
          </span>
        ) : null}
      </div>
      {dialog}
    </>
  );
}
