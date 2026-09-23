'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useDialogA11y } from './modal';

/** The exit animation's length (`--animate-drawer-out` in globals.css). */
const EXIT_MS = 220;

/**
 * A dialog that slides in from the right edge and runs the full height of the
 * viewport: for content read top to bottom next to the list it came from (one
 * response of the submissions table), where a centred `Modal` would cut a long
 * record into a box. Full width on a phone.
 *
 * Same dialog contract as `Modal` (Esc, Tab trap, focus in and back out,
 * `aria-hidden` behind it), through the shared `useDialogA11y`. The header and
 * footer stay put; only the body scrolls.
 *
 * It slides in from the right edge and back out to it. Closing keeps the panel
 * mounted for the exit animation only: the dialog contract (focus back to the
 * opener, the page un-hidden) ends the moment `open` goes false, and the
 * leaving panel is `inert`, so nothing can be clicked or focused in it on its
 * way out. The caller must keep passing the last content while it leaves.
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

  // Closing starts the exit animation; the panel unmounts once it has played.
  const [prevOpen, setPrevOpen] = useState(open);
  const [leaving, setLeaving] = useState(false);
  if (prevOpen !== open) {
    setPrevOpen(open);
    setLeaving(!open);
  }
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => setLeaving(false), EXIT_MS);
    return () => window.clearTimeout(t);
  }, [leaving]);

  if (!open && !leaving) return null;
  return (
    <div
      ref={rootRef}
      inert={leaving}
      data-state={leaving ? 'closed' : 'open'}
      className="fixed inset-0 z-50 flex justify-end"
    >
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className={`absolute inset-0 bg-background/70 backdrop-blur-xs ${
          leaving ? 'animate-backdrop-out' : 'animate-backdrop-in'
        }`}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        data-testid="drawer"
        className={`relative flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-border bg-popover shadow-2xl ${
          leaving ? 'animate-drawer-out' : 'animate-drawer-in'
        }`}
      >
        {/* A faint wash of the accent behind the header: the panel's one splash of color. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-linear-to-b from-primary/12 to-transparent"
        />
        <div className="relative shrink-0 border-b border-border px-5 py-4">{header}</div>
        <div className="relative min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer ? (
          <div className="relative shrink-0 border-t border-border bg-popover px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
