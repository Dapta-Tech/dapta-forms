'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * A menu panel that hangs off a trigger button but lives at the end of
 * `document.body`.
 *
 * Every popup opened from the sidebar rail has to leave the rail twice over:
 *
 *  1. **The clip.** The desktop rail is a scroll container
 *     (`md:overflow-y-auto`) and the mobile drawer is another one, so an
 *     `absolute` panel is cut off at the rail's edge — collapsed to 64px, a
 *     240px menu is almost entirely invisible.
 *  2. **The stacking context.** This is the half of the problem that
 *     `position: fixed` alone does NOT solve. The desktop rail is
 *     `md:sticky` and the mobile drawer is `fixed … z-50 … -translate-x-full`;
 *     each of those properties opens a stacking context, and a stacking
 *     context is a sealed box — `z-50` on a child ranks it against its
 *     siblings inside the box, never against the page. The rail's own box sits
 *     at `z-index: auto`, and it comes BEFORE `<main>` in the DOM, so every
 *     positioned element inside `<main>` (a `relative` question card is
 *     enough — no z-index required) paints on top of the whole rail, menu
 *     included. That is the builder screenshot: the switcher opens, and the
 *     question cards sit over it.
 *
 * A portal out of the rail is what fixes (2): the panel becomes a child of the
 * ROOT stacking context, where its z-index finally means what it says.
 * `position: fixed` + viewport coordinates then fixes (1).
 *
 * The target is always `document.body`, including on mobile. Portalling into
 * the drawer instead — to keep the panel inside its `aria-modal` subtree — was
 * tried and reverted: the drawer is 82vw, the panel is wider than what is left
 * of it, and the drawer's `overflow-y-auto` (which computes `overflow-x` to
 * `auto` with it) clips the overhang straight back off. The mobile hit test
 * catches it as the backdrop winning `elementFromPoint`. Assistive tech reaches
 * the panel because the drawer relies on `inert` siblings rather than
 * `aria-modal` for containment — see admin-shell.tsx.
 *
 * Because the panel is no longer a DOM descendant of the trigger, three things
 * that a normal `absolute` popup gets for free have to be done by hand:
 * dismissal tests the trigger and the panel separately (a `wrapRef.contains()`
 * check would close the menu the instant you clicked an item inside it), focus
 * is handed back to the trigger on the way out (the panel sits at the end of
 * `<body>`, so otherwise the caret is left on the document), and the panel is
 * clamped to the viewport in BOTH axes — being `fixed`, it cannot be scrolled
 * back into view, so anything that does not fit has to scroll inside itself.
 *
 * WAI-ARIA menu-button pattern: Escape and outside click dismiss, and focus
 * optionally lands on the first item when it opens.
 */

/** Gutter kept between the panel and the viewport edges. */
const EDGE = 8;
/** Space between the trigger and the panel. */
const GAP = 6;
/**
 * Below this a panel is a slit, not a menu. When neither side of the trigger
 * can hold at least this much, the panel takes the full usable viewport and
 * overlaps the trigger instead — the same trade a native `<select>` makes.
 */
const MIN_HEIGHT = 160;

/**
 * Above every popover, dropdown and modal inside `<main>` (all `z-50`), below
 * the toast stack (`z-[60]`) and the confirm dialog (`z-[70]`) — a destructive
 * confirmation must never end up under a workspace list.
 */
const Z_INDEX = 55;

interface Box {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

export function AnchoredMenu({
  anchorRef,
  open,
  onClose,
  label,
  width = 240,
  minWidth = 240,
  autoFocus = false,
  className = '',
  testId,
  children,
}: {
  /** The trigger the panel is positioned against and toggled by. */
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  /** Accessible name for the `role="menu"` panel. */
  label: string;
  /** Panel width in px, or `'anchor'` to match the trigger. */
  width?: number | 'anchor';
  /** Floor for `width: 'anchor'` only — the collapsed rail's trigger is 48px. */
  minWidth?: number;
  /** Move focus to the first `[role="menuitem"]` once the panel is placed. */
  autoFocus?: boolean;
  /** Padding/layout for the panel; the frame and z-index are fixed here. */
  className?: string;
  /** The panel leaves the trigger's subtree, so QA needs its own handle on it. */
  testId?: string;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  // Portals need a DOM to target, which the server render does not have.
  const [mounted, setMounted] = useState(false);
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => setMounted(true), []);

  // Kept in a ref so `place` stays referentially stable across renders.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // A dismissal that was a click elsewhere already put focus where the user
  // asked for it; only the other exits reclaim it. See the focus effect below.
  const pointerDismissRef = useRef(false);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    // The trigger stopped being rendered — dragging the window across the 768px
    // breakpoint swaps the desktop rail for the mobile drawer, and a menu
    // anchored to a display:none button would otherwise pin itself to 0,0.
    if (!anchor.isConnected || (rect.width === 0 && rect.height === 0)) {
      closeRef.current();
      return;
    }

    const w = width === 'anchor' ? Math.max(minWidth, rect.width) : width;
    // Clamp so the panel never leaves the viewport on a narrow screen.
    const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - w - EDGE));

    // Measure the CONTENT, not the rendered box: once a max-height is applied
    // the rendered box is the clamp itself, and reading that back would ratchet
    // the panel smaller on every pass. scrollHeight ignores the clamp; the
    // offset/client delta adds the borders it leaves out.
    const el = menuRef.current;
    const natural = el ? el.scrollHeight + (el.offsetHeight - el.clientHeight) : 0;

    const viewport = window.innerHeight;
    const spaceBelow = viewport - EDGE - (rect.bottom + GAP);
    const spaceAbove = rect.top - GAP - EDGE;

    if (Math.max(spaceBelow, spaceAbove) < MIN_HEIGHT) {
      // A very short window, or a trigger stranded mid-viewport. Overlapping
      // the trigger beats both alternatives: a panel squeezed into a slit, or
      // one hanging off an edge that — being `fixed` — no scroll can recover.
      setBox({ top: EDGE, left, width: w, maxHeight: viewport - EDGE * 2 });
      return;
    }

    // Prefer below. Flip up only when below cannot hold the content AND above
    // is genuinely roomier, so a long workspace list near the footer opens
    // toward the space that exists.
    const flip = natural > spaceBelow && spaceAbove > spaceBelow;
    const maxHeight = flip ? spaceAbove : spaceBelow;
    const height = Math.min(natural, maxHeight);
    setBox({
      top: flip ? rect.top - GAP - height : rect.bottom + GAP,
      left,
      width: w,
      maxHeight,
    });
  }, [anchorRef, minWidth, width]);

  // Re-place instead of closing on scroll: the rail itself scrolls
  // (`overflow-y-auto`), so a menu that closed on any scroll event was one
  // trackpad nudge away from vanishing. ResizeObserver covers the panel's own
  // content changing height (e.g. a pending state swapping rows).
  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      return;
    }
    place();
    const observer = new ResizeObserver(place);
    if (menuRef.current) observer.observe(menuRef.current);
    window.addEventListener('resize', place);
    // Capture phase: scrolls inside the rail do not bubble to window.
    window.addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // The trigger's own onClick toggles; swallowing it here would close and
      // immediately reopen. The panel is a portal, so it needs its own test.
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      pointerDismissRef.current = true;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  // Focus lands on the first item only once the panel is actually placed:
  // until then it is `visibility: hidden`, where `.focus()` is a silent no-op
  // that never retries. `placed` flips exactly once per open.
  const placed = box !== null;
  useEffect(() => {
    if (!open || !placed || !autoFocus) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, placed, autoFocus]);

  // Hand focus back on the way out. The panel is a portal at the end of
  // `<body>`, so when it unmounts the caret is left on the document instead of
  // on the control that opened it — and the tab order behind it is nowhere
  // near the rail.
  useEffect(() => {
    if (!open) return;
    pointerDismissRef.current = false;
    const trigger = anchorRef.current;
    return () => {
      if (pointerDismissRef.current) return;
      const active = document.activeElement;
      // Either ordering of unmount-vs-cleanup: focus is still on an item, or
      // it has already fallen through to the document.
      const adrift = !active || active === document.body || !!menuRef.current?.contains(active);
      if (adrift) trigger?.focus?.();
    };
  }, [open, anchorRef]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      data-testid={testId}
      style={{
        zIndex: Z_INDEX,
        top: box?.top ?? 0,
        left: box?.left ?? 0,
        width: box?.width,
        maxHeight: box?.maxHeight,
        // `fixed` means no ancestor scroll can ever bring an overflowing panel
        // back — whatever does not fit has to scroll in place. Inline so it
        // wins over an `overflow-hidden` in the caller's className, which stays
        // in force on the x axis and keeps the rounded corners clipping.
        overflowY: 'auto',
        // The first paint measures the panel to decide top/left; showing it at
        // 0,0 for that frame would read as a flicker in the corner.
        visibility: box ? 'visible' : 'hidden',
      }}
      className={`fixed rounded-md border border-border bg-popover text-popover-foreground shadow-lg ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}
