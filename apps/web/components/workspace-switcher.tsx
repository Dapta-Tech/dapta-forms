'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { FormsMessages } from '@quill/shared';
import type { Workspace } from '@/lib/admin-api';
import { refreshWorkspacesAction, switchWorkspaceAction } from '@/app/admin/workspace-actions';
import { AnchoredMenu } from '@/components/ui/anchored-menu';
import { CreateWorkspaceDialog } from '@/components/create-workspace-dialog';
import { callAction } from '@/lib/call-action';

type Messages = FormsMessages['admin']['chrome']['workspaces'];

/**
 * Which workspace you are in, how to change it, and how to make a new one.
 *
 * Always rendered — even with a single membership — because the menu is also
 * where "New workspace" lives, and that entry point must exist BEFORE there is
 * a second workspace to switch to. Opening the menu re-reads the list from the
 * identity service (when there is one), so a workspace created or joined in the
 * Dapta app appears without waiting for the projection's TTL.
 *
 * Switching is a server action: it rewrites the signed session cookie and
 * reloads. It grants nothing on its own — the API re-checks membership on every
 * request — so the worst a tampered choice can do is 403.
 *
 * The panel renders through AnchoredMenu — a portal to document.body — because
 * the rail clips it (overflow-y-auto) and, more importantly, buries it: the
 * rail is its own stacking context, so anything positioned inside <main> paints
 * over it no matter what z-index the panel carries. See anchored-menu.tsx.
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
  const [creating, setCreating] = useState(false);
  const [pending, start] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  // One refresh per open, never per render: the action revalidates the layout,
  // which re-renders this component with the fresh list.
  const refreshedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      refreshedRef.current = false;
      return;
    }
    if (refreshedRef.current) return;
    refreshedRef.current = true;
    void callAction(() => refreshWorkspacesAction());
  }, [open]);

  const current = workspaces.find((w) => w.accountId === currentAccountId);
  const label = current?.accountName ?? m.unknown;

  function choose(accountId: string) {
    if (accountId === currentAccountId) {
      setOpen(false);
      return;
    }
    start(async () => {
      await callAction(() => switchWorkspaceAction(accountId));
    });
  }

  return (
    <div data-testid="workspace-switcher">
      <button
        type="button"
        ref={triggerRef}
        data-testid="workspace-switcher-trigger"
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
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-primary/15 text-2xs font-semibold text-foreground"
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

      {/* Matches the trigger in the expanded rail; in the collapsed rail the
          trigger is a 48px square, so the floor keeps the names readable. */}
      <AnchoredMenu
        anchorRef={triggerRef}
        open={open}
        onClose={close}
        label={m.menuLabel}
        width="anchor"
        minWidth={200}
        autoFocus
        className="flex flex-col overflow-hidden py-1"
        testId="workspace-switcher-menu"
      >
        <p className="px-2.5 py-1 text-2xs font-medium uppercase tracking-wide text-faint">
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
                <span className="shrink-0 rounded-sm bg-secondary/15 px-1.5 py-0.5 text-2xs font-medium text-secondary">
                  {m.invited}
                </span>
              ) : null}
            </button>
          );
        })}
        <div className="my-1 border-t border-border" />
        <button
          type="button"
          role="menuitem"
          data-testid="workspace-create"
          onClick={() => {
            setOpen(false);
            setCreating(true);
          }}
          className="flex items-center gap-2 px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
        >
          <i aria-hidden className="pi pi-plus text-muted-foreground" style={{ fontSize: 11 }} />
          <span className="min-w-0 flex-1 truncate">{m.create}</span>
        </button>
      </AnchoredMenu>

      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} m={m} />
    </div>
  );
}
