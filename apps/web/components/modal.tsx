'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Accessible modal dialog: backdrop, Esc-to-close, role=dialog + aria-labelledby,
 * autofocus first control, focus restore to the opener, a Tab focus trap, and
 * `aria-hidden` on the rest of the page while it is up. Used for dedicated
 * create surfaces (list/create pattern) that suit a dialog over a full page.
 */
export function Modal({
  open,
  onClose,
  title,
  labelId,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  labelId: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /** The whole overlay — used to spare it (and its subtree) from aria-hidden. */
  const rootRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const FOCUSABLE =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    /** Visible, focusable controls inside the dialog, in DOM order. */
    const focusable = (): HTMLElement[] =>
      [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Trap Tab inside the dialog. Without this, the third Tab left the modal
      // and walked the row actions of the list BEHIND it — a keyboard user
      // ended up typing into a page they could not see was focused.
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (!ref.current?.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();

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
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div ref={rootRef} className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-hidden tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-background/80" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        className="relative w-full max-w-md rounded-xl border border-border bg-popover p-6 shadow-lg"
      >
        <h2 id={labelId} className="mb-4 text-lg font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
