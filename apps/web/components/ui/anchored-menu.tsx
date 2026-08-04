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
 * A portal to `document.body` is what fixes (2): the panel becomes a child of
 * the ROOT stacking context, where its z-index finally means what it says.
 * `position: fixed` + viewport coordinates then fixes (1).
 *
 * Because the panel is no longer a DOM descendant of the trigger, dismissal
 * has to test the trigger and the panel separately — a `wrapRef.contains()`
 * check would close the menu the instant you clicked an item inside it.
 *
 * WAI-ARIA menu-button pattern: Escape and outside click dismiss, and focus
 * optionally lands on the first item when it opens.
 */

/** Gutter kept between the panel and the viewport edges. */
const EDGE = 8;
/** Space between the trigger and the panel. */
const GAP = 6;

/**
 * Above every popover, dropdown and modal inside `<main>` (all `z-50`), below
 * the toast stack (`z-[60]`) and the confirm dialog (`z-[70]`) — a destructive
 * confirmation must never end up under a workspace list.
 */
const Z_INDEX = 55;

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
  /** Floor for `width: 'anchor'` — the collapsed rail's trigger is 48px wide. */
  minWidth?: number;
  /** Move focus to the first `[role="menuitem"]` on open. */
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
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => setMounted(true), []);

  // Kept in a ref so `place` stays referentially stable across renders.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

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
    const w = Math.max(minWidth, width === 'anchor' ? rect.width : width);
    // Clamp so the panel never leaves the viewport on a narrow screen.
    const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - w - EDGE));
    const height = menuRef.current?.offsetHeight ?? 0;
    const below = rect.bottom + GAP;
    // Flip above only when it would otherwise overflow the bottom AND there is
    // room up there — a long workspace list near the footer stays readable.
    const flip = height > 0 && below + height > window.innerHeight - EDGE && rect.top - GAP - height > EDGE;
    setBox({ top: flip ? rect.top - GAP - height : below, left, width: w });
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

  useEffect(() => {
    if (open && autoFocus) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, autoFocus]);

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
