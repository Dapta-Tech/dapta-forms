'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** Accessible modal dialog: backdrop, Esc-to-close, role=dialog + aria-labelledby,
 *  autofocus first control, focus restore to the opener. Used for dedicated
 *  create surfaces (list/create pattern) that suit a dialog over a full page. */
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
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
