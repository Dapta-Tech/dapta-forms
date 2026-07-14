'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { duplicateFormAction, deleteFormAction } from '@/app/admin/actions';

/**
 * Per-row actions for a form, as a single kebab menu (WAI-ARIA menu-button) —
 * replaces the cramped inline run of links that wrapped on narrow cards. Holds
 * the cross-links (Edit / Analytics / Submissions / Integrations) plus the
 * builder actions (Duplicate / Delete). Escape / outside-click dismiss; focus
 * the first item on open. Tokens only; R22 press feedback.
 */
export function FormRowActions({
  id,
  labels,
}: {
  id: string;
  labels: {
    menu: string;
    edit: string;
    analytics: string;
    submissions: string;
    integrations: string;
    duplicate: string;
    delete: string;
    deleteConfirm: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
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
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={labels.menu}
        title={labels.menu}
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[0.98]"
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
          <Link role="menuitem" tabIndex={-1} href={`/admin/forms/${id}/edit`} onClick={() => setOpen(false)} className={itemClass}>
            <i aria-hidden className="pi pi-pencil text-muted-foreground" style={{ fontSize: 13 }} />
            {labels.edit}
          </Link>
          <Link role="menuitem" tabIndex={-1} href={`/admin/forms/${id}/analytics`} onClick={() => setOpen(false)} className={itemClass}>
            <i aria-hidden className="pi pi-chart-bar text-muted-foreground" style={{ fontSize: 13 }} />
            {labels.analytics}
          </Link>
          <Link role="menuitem" tabIndex={-1} href={`/admin/forms/${id}/submissions`} onClick={() => setOpen(false)} className={itemClass}>
            <i aria-hidden className="pi pi-inbox text-muted-foreground" style={{ fontSize: 13 }} />
            {labels.submissions}
          </Link>
          <Link role="menuitem" tabIndex={-1} href={`/admin/forms/${id}/integrations`} onClick={() => setOpen(false)} className={itemClass}>
            <i aria-hidden className="pi pi-link text-muted-foreground" style={{ fontSize: 13 }} />
            {labels.integrations}
          </Link>

          <div className="my-1 border-t border-border" role="separator" />

          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={pending}
            onClick={() => {
              setOpen(false);
              start(() => void duplicateFormAction(id));
            }}
            className={`${itemClass} disabled:opacity-50`}
          >
            <i aria-hidden className="pi pi-copy text-muted-foreground" style={{ fontSize: 13 }} />
            {labels.duplicate}
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={pending}
            onClick={() => {
              if (confirm(labels.deleteConfirm)) {
                setOpen(false);
                start(() => void deleteFormAction(id));
              }
            }}
            className="flex w-full items-center gap-2.5 rounded-sm px-2 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10 focus-visible:bg-destructive/10 focus-visible:outline-none disabled:opacity-50"
          >
            <i aria-hidden className="pi pi-trash" style={{ fontSize: 13 }} />
            {labels.delete}
          </button>
        </div>
      ) : null}
    </div>
  );
}
