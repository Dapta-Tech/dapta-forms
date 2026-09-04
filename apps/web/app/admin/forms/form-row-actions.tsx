'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { getMessages } from '@quill/shared';
import { duplicateFormAction, deleteFormAction } from '@/app/admin/actions';
import { clientLocale } from '@/lib/client-locale';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { callAction } from '@/lib/call-action';
import type { Folder } from '@/lib/admin-api';

export interface FormRowActionLabels {
  menu: string;
  duplicate: string;
  delete: string;
  deleteConfirm: string;
  /** "Move to folder" group + the unfile choice; absent = no folders on this surface. */
  moveTo?: string;
  moveBack?: string;
}

/**
 * Overflow menu for a form row (WAI-ARIA menu-button). The cross-links
 * (Edit / Submissions / Analytics / Connect) are first-class buttons on the
 * row itself now — this kebab holds only the destructive/rare builder actions
 * (Duplicate / Delete). Escape / outside-click dismiss; focus the first item
 * on open. Tokens only; R22 press feedback.
 */
export function FormRowActions({
  id,
  labels,
  folders = [],
  currentFolderId = null,
  onMove,
}: {
  id: string;
  labels: FormRowActionLabels;
  /** The workspace's folders, for the "Move to folder" radio group (keyboard fallback to drag). */
  folders?: Folder[];
  currentFolderId?: string | null;
  onMove?: (folderId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const { confirm: confirmDialog, dialog } = useConfirmDialog();
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const itemClass =
    'flex w-full items-center gap-2.5 rounded-sm px-2 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none';

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        data-testid="form-row-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={labels.menu}
        title={labels.menu}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[0.98]"
      >
        <i aria-hidden className="pi pi-ellipsis-v" style={{ fontSize: 16 }} />
      </button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={labels.menu}
          className="absolute right-0 z-50 mt-2 w-52 rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={pending}
            onClick={() => {
              setOpen(false);
              start(() => void callAction(() => duplicateFormAction(id)));
            }}
            className={`${itemClass} disabled:opacity-50`}
          >
            <i aria-hidden className="pi pi-copy text-muted-foreground" style={{ fontSize: 13 }} />
            {labels.duplicate}
          </button>
          {onMove && labels.moveTo && folders.length > 0 ? (
            <div role="group" aria-label={labels.moveTo} className="my-1 border-y border-border py-1">
              <p className="px-2 pb-1 pt-0.5 text-2xs font-medium uppercase tracking-wide text-faint">{labels.moveTo}</p>
              {[{ id: null as string | null, name: labels.moveBack ?? '' }, ...folders].map((folder) => {
                const checked = (folder.id ?? null) === (currentFolderId ?? null);
                return (
                  <button
                    key={folder.id ?? 'none'}
                    type="button"
                    role="menuitemradio"
                    aria-checked={checked}
                    tabIndex={-1}
                    disabled={pending || checked}
                    data-testid={`form-row-move-${folder.id ?? 'none'}`}
                    onClick={() => {
                      setOpen(false);
                      onMove(folder.id);
                    }}
                    className={`${itemClass} disabled:opacity-60`}
                  >
                    <i
                      aria-hidden
                      className={`pi ${checked ? 'pi-check' : 'pi-folder'} text-muted-foreground`}
                      style={{ fontSize: 13 }}
                    />
                    <span className="truncate">{folder.name}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={pending}
            onClick={() => {
              setOpen(false);
              void confirmDialog({
                title: getMessages(clientLocale()).dialog.deleteFormTitle,
                message: labels.deleteConfirm,
                confirmLabel: labels.delete,
                destructive: true,
              }).then((ok) => {
                if (ok) start(() => void callAction(() => deleteFormAction(id)));
              });
            }}
            className="flex w-full items-center gap-2.5 rounded-sm px-2 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10 focus-visible:bg-destructive/10 focus-visible:outline-none disabled:opacity-50"
          >
            <i aria-hidden className="pi pi-trash" style={{ fontSize: 13 }} />
            {labels.delete}
          </button>
        </div>
      ) : null}
      {dialog}
    </div>
  );
}
