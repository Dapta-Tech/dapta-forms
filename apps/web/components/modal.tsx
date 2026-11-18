'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { FOCUSABLE_SELECTOR } from '@/lib/focusable';
import { LAYER } from '@/lib/layers';

/**
 * Accessible modal dialog: backdrop, Esc-to-close, role=dialog + aria-labelledby,
 * autofocus first control, focus restore to the opener, a Tab focus trap, and
 * `aria-hidden` on the rest of the page while it is up. Used for dedicated
 * create surfaces (list/create pattern) that suit a dialog over a full page.
 */
/**
 * Panel widths. `md` (448px) is the historical hard-coded value and stays the
 * default so every existing call site renders identically. `lg`/`xl` exist
 * because some dialogs are editors, not confirmations: the per-question logic
 * dialog packs two condition editors and a rule list, and at 448px those wrap
 * into an unreadable column. `2xl` is for a dialog whose content is a document
 * rather than a form: an uploaded PDF at 896px is readable but cramped, and the
 * next step up is the width the device preview already chose for itself.
 *
 * Before this prop the only way out was to hand-roll a dialog next to this one
 * (see `device-preview-modal.tsx`), which forfeits the focus trap and the
 * aria-hidden handling below.
 */
const SIZES = {
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-5xl',
} as const;

export function Modal({
  open,
  onClose,
  title,
  labelId,
  size = 'md',
  portal = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  labelId: string;
  /** Panel width. Defaults to the original `md` so callers are unaffected. */
  size?: keyof typeof SIZES;
  /**
   * Render at the end of `document.body` instead of in place. For a dialog
   * opened from inside a stacking context it cannot paint out of: the rail's
   * "New workspace" dialog sat inside the `md:sticky` rail, so every
   * positioned element in `<main>` (the Home card's animated chips) painted
   * over its Name field and Create button, and inside the mobile drawer the
   * drawer's transform made the "full screen" overlay as wide as the drawer.
   * Same reasons, same fix, as the rail's menus (ui/anchored-menu.tsx).
   *
   * Off by default because nesting is decided by the DOM: `inNestedDialog`
   * and the drawers' key handlers ask `panel.contains(...)`, so a dialog
   * opened from another dialog has to stay inside it. A dialog opened from
   * the page's chrome is never nested, which is when to turn this on.
   */
  portal?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /** The whole overlay — used to spare it (and its subtree) from aria-hidden. */
  const rootRef = useRef<HTMLDivElement>(null);
  // `document.body` exists only after mount; the server and the first client
  // render agree on nothing being there.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // The dialog setup (focus, aria-hidden siblings) needs the overlay in the
  // DOM, so it keys on what is actually shown, not on `open` alone.
  const shown = open && (!portal || mounted);
  useDialogA11y(shown, ref, rootRef, onClose);

  if (!shown) return null;
  const overlay = (
    <div
      ref={rootRef}
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: LAYER.overlay }}
    >
      <button type="button" aria-hidden tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-background/80" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        className={`relative w-full ${SIZES[size]} rounded-xl border border-border bg-popover p-6 shadow-lg`}
      >
        <h2 id={labelId} className="mb-4 text-lg font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
  return portal ? createPortal(overlay, document.body) : overlay;
}

/**
 * What makes an overlay a dialog rather than a floating box, shared by `Modal`
 * and `Drawer`: Esc closes, Tab is trapped inside `panelRef`, the first control
 * takes focus on open, focus goes back to the opener on close, and the rest of
 * the page is `aria-hidden` while it is up.
 *
 * A dialog opened INSIDE this one (a file preview opened from a drawer, a
 * confirm opened from a modal) owns its own keys: an Escape or a Tab whose
 * target sits in a nested dialog is left to that dialog, so Esc closes the
 * preview and not the drawer underneath it.
 */
export function useDialogA11y(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  rootRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  const restoreRef = useRef<HTMLElement | null>(null);
  /**
   * `onClose` behind a ref so the setup effect below can depend on `open` ALONE.
   *
   * Every call site passes an inline arrow (`onClose={() => setLogicView(null)}`),
   * so `onClose` gets a new identity on each render of the parent. With it in the
   * dep array the whole effect tore down and set up again on every keystroke the
   * dialog fed back to the editor, and its last setup line focuses the FIRST
   * control in the dialog. Editing a score in the outcomes list therefore moved
   * focus to the top row, and the browser scrolled that row into view, throwing
   * the author back to the top of a list they were working halfway down.
   * The handler reads through the ref, so Esc still calls the current `onClose`.
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    /** Visible, focusable controls inside the dialog, in DOM order. */
    const focusable = (): HTMLElement[] =>
      [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    const onKey = (e: KeyboardEvent) => {
      if (inNestedDialog(e.target, panelRef.current)) return;
      if (e.key === 'Escape') {
        // Consumed, for a surface underneath that also closes on Esc (the
        // full-screen table sheet): by the time its listener runs, this
        // dialog may already be gone from the page, so it cannot look for it.
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      // Trap Tab inside the dialog. Without this, the third Tab left the modal
      // and walked the row actions of the list BEHIND it: a keyboard user
      // ended up typing into a page they could not see was focused.
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      // Every Tab is moved by hand, not only the one at either end. Safari
      // does not Tab to buttons or links, so from the "New workspace" Name
      // field (its only text input) the native Tab skipped Cancel and Create,
      // the wrap at the last control never ran, and focus left the dialog.
      // By hand, the order is this list in every browser; the same fix as the
      // submissions sheet's trap (response-panel.tsx).
      e.preventDefault();
      const n = items.length;
      const active = document.activeElement as HTMLElement | null;
      const at = active ? items.indexOf(active) : -1;
      if (at >= 0) {
        items[(at + (e.shiftKey ? n - 1 : 1)) % n]!.focus();
        return;
      }
      if (!active || !panelRef.current?.contains(active)) {
        items[e.shiftKey ? n - 1 : 0]!.focus();
        return;
      }
      // Focus is inside on something Tab does not stop at (the panel itself, a
      // `tabIndex={-1}` region): go to the next control after it, as native.
      const next = items.findIndex(
        (el) => (active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      );
      if (e.shiftKey) items[next <= 0 ? n - 1 : next - 1]!.focus();
      else items[next < 0 ? 0 : next]!.focus();
    };
    window.addEventListener('keydown', onKey);
    // First ENABLED control: the drawer's first button is "previous response",
    // disabled on the first row, and focusing a disabled button is a no-op that
    // leaves focus on the page behind the dialog.
    panelRef.current
      ?.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
      )
      ?.focus();

    // Hide the rest of the page from assistive tech while the dialog is up, so
    // a screen reader cannot wander into content the pointer cannot reach.
    const siblings = [...document.body.children].filter(
      (el) => el !== rootRef.current && !el.contains(rootRef.current as Node),
    ) as HTMLElement[];
    const previous = siblings.map((el) => el.getAttribute('aria-hidden'));
    siblings.forEach((el) => el.setAttribute('aria-hidden', 'true'));

    return () => {
      window.removeEventListener('keydown', onKey);
      siblings.forEach((el, i) => {
        const prev = previous[i];
        if (prev == null) el.removeAttribute('aria-hidden');
        else el.setAttribute('aria-hidden', prev);
      });
      restoreRef.current?.focus?.();
    };
    // panelRef and rootRef are stable ref objects; `open` is the only real input.
  }, [open]);
}

/**
 * True when `target` sits inside a dialog (`role="dialog"` or a confirm's
 * `role="alertdialog"`) that is itself inside `panel`: a dialog opened from
 * this one, which handles its own keys.
 */
export function inNestedDialog(target: EventTarget | null, panel: HTMLElement | null): boolean {
  if (!panel || !(target instanceof Element)) return false;
  const owner = target.closest('[role="dialog"], [role="alertdialog"]');
  return owner != null && owner !== panel && panel.contains(owner);
}
