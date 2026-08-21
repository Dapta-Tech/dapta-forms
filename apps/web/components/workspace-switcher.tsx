'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { t, type FormsMessages } from '@quill/shared';
import type { MemberStatus, Workspace, WorkspaceSearchRow } from '@/lib/admin-api';
import {
  enterEstateWorkspaceAction,
  refreshWorkspacesAction,
  searchWorkspacesAction,
  switchWorkspaceAction,
} from '@/app/admin/workspace-actions';
import { AnchoredMenu } from '@/components/ui/anchored-menu';
import { CreateWorkspaceDialog } from '@/components/create-workspace-dialog';
import { callAction, isTransportError } from '@/lib/call-action';

type Messages = FormsMessages['admin']['chrome']['workspaces'];

/** The search box appears from this many workspaces (the Dapta app shows its own from six). */
const SEARCH_FROM = 6;
/** Keystrokes settle for this long before the estate is asked. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * One line of the menu, whichever list it came from: the caller's own
 * workspaces (`accountId` set, entered with a plain switch) or, for the
 * deployment's staff, an estate workspace never opened here (`accountId`
 * null, `workspaceId` set, entered through the staff grant).
 */
interface Row {
  key: string;
  accountId: string | null;
  workspaceId: string | null;
  name: string;
  status: MemberStatus;
  /** Shows the "Staff" badge: in it by grant, or an estate row. */
  staff: boolean;
  estate: boolean;
  /** Why an estate row matched when its name did not (staff search). */
  hint?: { kind: 'email' | 'form'; value: string } | null;
}

/**
 * Which workspace you are in, how to change it, and how to make a new one.
 *
 * Always rendered, even with a single membership, because the menu is also
 * where "New workspace" lives, and that entry point must exist BEFORE there is
 * a second workspace to switch to. Opening the menu re-reads the list from the
 * identity service (when there is one), so a workspace created or joined in the
 * Dapta app appears without waiting for the projection's TTL.
 *
 * Type-to-find. From six workspaces (or always for the deployment's staff) a
 * search box sits above the list and takes the caret when the menu opens. An
 * empty query shows the list as is. A query filters the list client-side at
 * once (name contains, case-insensitive) and, for staff, also asks the server
 * after a short debounce: the reply's own rows merge into the list, and the
 * estate rows (workspaces the person holds no membership in) follow under an
 * "All workspaces" eyebrow. Replies are tagged with the query they answered, so
 * a slow reply for an older query is never painted over a newer one.
 *
 * Switching is a server action: it rewrites the signed session cookie and
 * reloads. It grants nothing on its own; the API re-checks membership (or the
 * staff grant) on every request, so the worst a tampered choice can do is 403.
 *
 * The panel renders through AnchoredMenu, a portal to document.body, because
 * the rail clips it (overflow-y-auto) and, more importantly, buries it: the
 * rail is its own stacking context, so anything positioned inside <main> paints
 * over it no matter what z-index the panel carries. See anchored-menu.tsx.
 *
 * WAI-ARIA menu-button pattern, matching AppSwitcher: Escape and outside click
 * dismiss. Focus lands on the search box when there is one, otherwise on the
 * first item; ArrowDown/ArrowUp walk the items (and back up into the box) and
 * Enter in the box picks the first visible row.
 */
export function WorkspaceSwitcher({
  workspaces,
  currentAccountId,
  collapsed = false,
  staff = false,
  m,
}: {
  workspaces: Workspace[];
  currentAccountId: string;
  collapsed?: boolean;
  /** Staff of the deployment: the search box is always shown and reaches the whole estate. */
  staff?: boolean;
  m: Messages;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pending, start] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
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

  const showSearch = staff || workspaces.length >= SEARCH_FROM;

  // ---- type-to-find ------------------------------------------------------
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  // The server's answer, tagged with the query it answered. Only the answer to
  // the CURRENT query is ever painted; anything else is a stale reply.
  const [results, setResults] = useState<{ q: string; rows: WorkspaceSearchRow[] } | null>(null);
  const [searching, setSearching] = useState(false);
  // Monotonic request counter: a reply is applied only if nothing newer was
  // sent after it, so a slow answer cannot overwrite a fast one.
  const requestRef = useRef(0);

  // Reset the box when the menu closes, so it reopens clean.
  useEffect(() => {
    if (open) return;
    setQuery('');
    setResults(null);
    setSearching(false);
    requestRef.current += 1;
  }, [open]);

  useEffect(() => {
    if (!open || !staff || !needle) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const q = needle;
    const timer = setTimeout(() => {
      const id = ++requestRef.current;
      void (async () => {
        const res = await callAction(() => searchWorkspacesAction(q));
        if (id !== requestRef.current) return;
        setResults({ q, rows: isTransportError(res) ? [] : res.rows });
        setSearching(false);
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, staff, needle]);

  // Focus the search box once the panel is on screen. AnchoredMenu keeps the
  // panel `visibility: hidden` until it has measured and placed itself, and a
  // hidden input ignores `.focus()` without a word, so this retries for a few
  // frames instead of firing once into the void.
  useEffect(() => {
    if (!open || !showSearch) return;
    let frame = 0;
    let tries = 0;
    const attempt = () => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        if (document.activeElement === el) return;
      }
      if (++tries < 10) frame = requestAnimationFrame(attempt);
    };
    attempt();
    return () => cancelAnimationFrame(frame);
  }, [open, showSearch]);

  const current = workspaces.find((w) => w.accountId === currentAccountId);
  const label = current?.accountName ?? m.unknown;

  // Own workspaces first (the prop list, filtered client-side, plus any own row
  // the server matched that the list does not carry yet), then estate rows.
  const { own, estate } = useMemo(() => {
    const ownRows: Row[] = [];
    const seenAccounts = new Set<string>();
    for (const w of workspaces) {
      if (needle && !w.accountName.toLowerCase().includes(needle)) continue;
      seenAccounts.add(w.accountId);
      ownRows.push({
        key: `a:${w.accountId}`,
        accountId: w.accountId,
        workspaceId: w.workspaceId,
        name: w.accountName,
        status: w.status,
        staff: w.accessGrant === 'staff',
        estate: false,
      });
    }
    const estateRows: Row[] = [];
    const seenWorkspaces = new Set<string>();
    const fresh = results && results.q === needle && needle ? results.rows : [];
    for (const r of fresh) {
      if (r.accountId) {
        if (seenAccounts.has(r.accountId)) continue;
        seenAccounts.add(r.accountId);
        ownRows.push({
          key: `a:${r.accountId}`,
          accountId: r.accountId,
          workspaceId: r.workspaceId,
          name: r.name,
          status: r.status,
          staff: r.accessGrant === 'staff',
          estate: false,
        });
        continue;
      }
      if (!r.workspaceId || seenWorkspaces.has(r.workspaceId)) continue;
      seenWorkspaces.add(r.workspaceId);
      estateRows.push({
        key: `w:${r.workspaceId}`,
        accountId: null,
        workspaceId: r.workspaceId,
        name: r.name,
        status: r.status,
        staff: true,
        estate: true,
        hint: r.hint ?? null,
      });
    }
    return { own: ownRows, estate: estateRows };
  }, [workspaces, needle, results]);

  function choose(accountId: string) {
    if (accountId === currentAccountId) {
      setOpen(false);
      return;
    }
    start(async () => {
      await callAction(() => switchWorkspaceAction(accountId));
    });
  }

  function pick(row: Row) {
    if (row.accountId) {
      choose(row.accountId);
      return;
    }
    const workspaceId = row.workspaceId;
    if (!workspaceId) return;
    start(async () => {
      await callAction(() => enterEstateWorkspaceAction(workspaceId));
    });
  }

  // Roving focus over the real buttons: ArrowDown/ArrowUp walk every
  // `[role="menuitem"]` in DOM order; ArrowUp from the first climbs back into
  // the search box when there is one.
  function onListKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const at = active ? items.indexOf(active) : -1;
    e.preventDefault();
    if (e.key === 'ArrowDown') {
      items[at < 0 || at === items.length - 1 ? 0 : at + 1]?.focus();
      return;
    }
    if (at <= 0) {
      if (inputRef.current) inputRef.current.focus();
      else items[items.length - 1]?.focus();
      return;
    }
    items[at - 1]?.focus();
  }

  // Enter picks the first visible row. Arrows bubble to the wrapper
  // (onListKeyDown). Everything else is plain typing: nothing global listens
  // for letters, and Escape must keep bubbling so AnchoredMenu can close.
  function onInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = own[0] ?? estate[0];
    if (first) pick(first);
  }

  const showEmpty =
    !!needle && own.length === 0 && (!staff || (!searching && estate.length === 0));

  const rowClass =
    'flex items-center gap-2 px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none';

  function renderRow(row: Row) {
    const active = row.accountId !== null && row.accountId === currentAccountId;
    return (
      <button
        key={row.key}
        type="button"
        role="menuitem"
        data-testid="workspace-option"
        data-account-id={row.accountId ?? undefined}
        data-workspace-id={row.workspaceId ?? undefined}
        onClick={() => pick(row)}
        className={rowClass}
      >
        <i
          aria-hidden
          className={`pi ${active ? 'pi-check text-primary' : 'pi-circle-off opacity-0'}`}
          style={{ fontSize: 11 }}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{row.name}</span>
          {/* Matched by a member's email or a form's name, not by the workspace
              name: say so, or the row reads as a wrong answer. */}
          {row.hint ? (
            <span className="truncate text-2xs text-faint" data-testid="workspace-option-hint">
              {row.hint.kind === 'form' ? t(m.hintForm, { name: row.hint.value }) : row.hint.value}
            </span>
          ) : null}
        </span>
        {/* An invitation you have not opened yet. Naming it is the difference
            between "why are there two?" and "ah, that one is waiting for me." */}
        {row.status === 'invited' && !row.estate ? (
          <span className="shrink-0 rounded-sm bg-secondary/15 px-1.5 py-0.5 text-2xs font-medium text-secondary">
            {m.invited}
          </span>
        ) : null}
        {/* In it by the staff grant, not by membership: neutral, so it never
            reads as an invitation or a warning. */}
        {row.staff ? (
          <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
            {m.staff}
          </span>
        ) : null}
      </button>
    );
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
          trigger is a 48px square, so the floor keeps the names readable. With
          a search box the floor is wider still, so a query has room to be
          read back. */}
      <AnchoredMenu
        anchorRef={triggerRef}
        open={open}
        onClose={close}
        label={m.menuLabel}
        width="anchor"
        minWidth={showSearch ? 240 : 200}
        autoFocus={!showSearch}
        className="flex flex-col overflow-hidden py-1"
        testId="workspace-switcher-menu"
      >
        <div ref={listRef} onKeyDown={onListKeyDown} className="flex flex-col">
          {showSearch ? (
            <label className="relative mx-2 my-1 block">
              <i
                aria-hidden
                className="pi pi-search pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                style={{ fontSize: 12 }}
              />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder={m.search}
                aria-label={m.search}
                autoComplete="off"
                spellCheck={false}
                data-testid="workspace-search-input"
                className="w-full rounded-md border border-input bg-background py-1.5 pl-7 pr-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          ) : null}

          <p className="px-2.5 py-1 text-2xs font-medium uppercase tracking-wide text-faint">
            {m.eyebrow}
          </p>
          {own.map(renderRow)}

          {estate.length > 0 ? (
            <>
              <p className="mt-1 px-2.5 py-1 text-2xs font-medium uppercase tracking-wide text-faint">
                {m.estate}
              </p>
              {estate.map(renderRow)}
            </>
          ) : null}

          {staff && needle && searching ? (
            <p
              role="status"
              className="flex items-center gap-2 px-2.5 py-1.5 text-sm text-muted-foreground"
              data-testid="workspace-searching"
            >
              <i aria-hidden className="pi pi-spinner pi-spin" style={{ fontSize: 11 }} />
              <span>{m.searching}</span>
            </p>
          ) : null}

          {showEmpty ? (
            <p
              role="status"
              className="px-2.5 py-1.5 text-sm text-muted-foreground"
              data-testid="workspace-search-empty"
            >
              {m.searchEmpty}
            </p>
          ) : null}

          <div className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            data-testid="workspace-create"
            onClick={() => {
              setOpen(false);
              setCreating(true);
            }}
            className={rowClass}
          >
            <i aria-hidden className="pi pi-plus text-muted-foreground" style={{ fontSize: 11 }} />
            <span className="min-w-0 flex-1 truncate">{m.create}</span>
          </button>
        </div>
      </AnchoredMenu>

      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} m={m} />
    </div>
  );
}
