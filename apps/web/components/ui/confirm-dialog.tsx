'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { getMessages } from '@quill/shared';
import { clientLocale } from '@/lib/client-locale';
import { Button } from '@/components/ui/button';

/**
 * Branded replacement for native `window.confirm()` — the ugly OS popup broke
 * the app's dark/light look. Same contract (ask, await a boolean), but rendered
 * with the app's tokens and full dialog a11y (role=alertdialog, focus trap,
 * Esc/overlay = cancel, focus restore).
 *
 * Usage (call sites stay one-liner-ish):
 *   const { confirm, dialog } = useConfirmDialog();
 *   ...
 *   if (!(await confirm({ title, message, destructive: true }))) return;
 *   ...
 *   return <>{ui}{dialog}</>;
 */
export interface ConfirmDialogOptions {
  title: string;
  message: string;
  /** Confirm button copy — defaults to the catalog's generic `dialog.confirm`. */
  confirmLabel?: string;
  /** Cancel button copy — defaults to the catalog's generic `dialog.cancel`. */
  cancelLabel?: string;
  /** Style the confirm button as a destructive (red) action. */
  destructive?: boolean;
}

interface ActiveConfirm extends ConfirmDialogOptions {
  resolve: (accepted: boolean) => void;
}

export function useConfirmDialog(): {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [active, setActive] = useState<ActiveConfirm | null>(null);
  const activeRef = useRef<ActiveConfirm | null>(null);

  const confirm = useCallback(
    (options: ConfirmDialogOptions) =>
      new Promise<boolean>((resolve) => {
        // A second ask while one is open replaces it; the superseded one cancels.
        activeRef.current?.resolve(false);
        const next: ActiveConfirm = { ...options, resolve };
        activeRef.current = next;
        setActive(next);
      }),
    [],
  );

  const close = useCallback((accepted: boolean) => {
    const current = activeRef.current;
    activeRef.current = null;
    setActive(null);
    current?.resolve(accepted);
  }, []);

  return {
    confirm,
    dialog: active ? <ConfirmDialog options={active} onClose={close} /> : null,
  };
}

/** Everything focusable inside the dialog card (for the Tab cycle). */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function ConfirmDialog({
  options,
  onClose,
}: {
  options: ConfirmDialogOptions;
  onClose: (accepted: boolean) => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    // Least-destructive control gets initial focus.
    cancelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose(false);
        return;
      }
      if (e.key !== 'Tab') return;
      // Focus trap: Tab cycles within the card in both directions.
      const items = cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!items || items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const inside = cardRef.current?.contains(document.activeElement) ?? false;
      if (e.shiftKey && (!inside || document.activeElement === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    // Capture phase so an open menu/modal underneath never sees the Escape.
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      restoreRef.current?.focus?.();
    };
  }, [onClose]);

  const dm = getMessages(clientLocale()).dialog;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={() => onClose(false)}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        ref={cardRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        data-testid="confirm-dialog"
        className="relative w-full max-w-sm rounded-md border border-border bg-card p-5 text-card-foreground shadow-lg"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight">
          {options.title}
        </h2>
        <p id={messageId} className="mt-2 text-sm text-muted-foreground">
          {options.message}
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button
            ref={cancelRef}
            variant="secondary"
            data-testid="confirm-dialog-cancel"
            onClick={() => onClose(false)}
          >
            {options.cancelLabel ?? dm.cancel}
          </Button>
          <Button
            variant={options.destructive ? 'destructive' : 'default'}
            data-testid="confirm-dialog-confirm"
            onClick={() => onClose(true)}
          >
            {options.confirmLabel ?? dm.confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}
