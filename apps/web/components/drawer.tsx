'use client';

import { useRef, type ReactNode } from 'react';
import { useDialogA11y } from './modal';

/**
 * A dialog that slides in from the right edge and runs the full height of the
 * viewport: for content read top to bottom next to the list it came from (one
 * response of the submissions table), where a centred `Modal` would cut a long
 * record into a box. Full width on a phone.
 *
 * Same dialog contract as `Modal` (Esc, Tab trap, focus in and back out,
 * `aria-hidden` behind it), through the shared `useDialogA11y`. The header and
 * footer stay put; only the body scrolls.
 */
export function Drawer({
  open,
  onClose,
  labelId,
  header,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Id of the element inside `header` that names the dialog. */
  labelId: string;
  header: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useDialogA11y(open, ref, rootRef, onClose);

  if (!open) return null;
  return (
    <div ref={rootRef} className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-background/60"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        data-testid="drawer"
        className="relative flex h-full w-full max-w-xl flex-col border-l border-border bg-popover shadow-xl"
      >
        <div className="shrink-0 border-b border-border px-5 py-4">{header}</div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="shrink-0 border-t border-border px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}
