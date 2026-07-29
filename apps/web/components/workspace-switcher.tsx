'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { FormsMessages } from '@quill/shared';
import type { Workspace } from '@/lib/admin-api';
import { switchWorkspaceAction } from '@/app/admin/workspace-actions';

type Messages = FormsMessages['admin']['chrome']['workspaces'];

/**
 * Which workspace you are in, and how to change it.
 *
 * Renders NOTHING for someone who belongs to a single account — the overwhelming
 * majority — because a picker with one entry is a control that teaches you it
 * does nothing. It appears the moment a second membership exists, which in
 * practice is the moment an invitation is accepted.
 *
 * Switching is a server action: it rewrites the signed session cookie and
 * reloads. It grants nothing on its own — the API re-checks membership on every
 * request — so the worst a tampered choice can do is 403.
 *
 * WAI-ARIA menu-button pattern, matching AppSwitcher: Escape and outside click
 * dismiss, and focus lands on the first item when it opens.
 */
export function WorkspaceSwitcher({
  workspaces,
  currentAccountId,
  collapsed = false,
  m,
}: {
  workspaces: Workspace[];
  currentAccountId: string;
  collapsed?: boolean;
  m: Messages;
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // One membership is not a choice. Say nothing rather than show a dead control.
  if (workspaces.length < 2) return null;

  const current = workspaces.find((w) => w.accountId === currentAccountId);
  const label = current?.accountName ?? m.unknown;

  function choose(accountId: string) {
    if (accountId === currentAccountId) {
      setOpen(false);
      return;
    }
    start(async () => {
      await switchWorkspaceAction(accountId);
    });
  }

  return (
    <div ref={wrapRef} className="relative" data-testid="workspace-switcher">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        title={collapsed ? label : undefined}
        className={`flex w-full items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${
          collapsed ? 'justify-center' : ''
        }`}
      >
        <span
          aria-hidden
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/15 text-[10px] font-semibold text-foreground"
        >
          {label.slice(0, 1).toUpperCase()}
        </span>
        {!collapsed ? (
          <>
            <span className="min-w-0 flex-1 truncate text-foreground" data-testid="workspace-current">
              {label}
            </span>
            <i
              aria-hidden
              className={`pi ${pending ? 'pi-spinner pi-spin' : 'pi-chevron-down'} text-muted-foreground`}
              style={{ fontSize: 10 }}
            />
          </>
        ) : null}
      </button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={m.menuLabel}
          className="absolute left-0 right-0 top-full z-50 mt-1 flex flex-col overflow-hidden rounded-md border border-border bg-popover py-1 shadow-lg"
        >
          <p className="px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {m.eyebrow}
          </p>
          {workspaces.map((w) => {
            const active = w.accountId === currentAccountId;
            return (
              <button
                key={w.accountId}
                type="button"
                role="menuitem"
                onClick={() => choose(w.accountId)}
                className="flex items-center gap-2 px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <i
                  aria-hidden
                  className={`pi ${active ? 'pi-check text-primary' : 'pi-circle-off opacity-0'}`}
                  style={{ fontSize: 11 }}
                />
                <span className="min-w-0 flex-1 truncate">{w.accountName}</span>
                {/* An invitation you have not opened yet. Naming it is the
                    difference between "why are there two?" and "ah, that one is
                    waiting for me." */}
                {w.status === 'invited' ? (
                  <span className="shrink-0 rounded-sm bg-secondary/15 px-1.5 py-0.5 text-[10px] font-medium text-secondary">
                    {m.invited}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
