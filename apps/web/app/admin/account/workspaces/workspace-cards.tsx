'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { FormsMessages, Locale } from '@quill/shared';
import { t } from '@quill/shared';
import type { AccountRole, Workspace, WorkspaceSearchRow } from '@/lib/admin-api';
import {
  enterEstateWorkspaceAction,
  searchWorkspacesAction,
  switchWorkspaceAction,
} from '@/app/admin/workspace-actions';
import { Button, buttonVariants } from '@/components/ui/button';
import { CreateWorkspaceDialog } from '@/components/create-workspace-dialog';
import { useToast } from '@/components/toast';
import { callAction, isTransportError } from '@/lib/call-action';
import { cn } from '@/lib/cn';

export interface WorkspaceCardsLabels {
  title: string;
  subtitle: string;
  search: string;
  searchEmpty: string;
  newWorkspace: string;
  current: string;
  invited: string;
  open: string;
  manage: string;
  yourRole: string;
  memberOne: string;
  /** {count} */
  memberOther: string;
  empty: string;
  roleOwner: string;
  roleAdmin: string;
  roleMember: string;
  /** Shown when entering a workspace fails (the API refused, or the call never landed). */
  openErrorForbidden: string;
  openErrorFailed: string;
  /** The "New workspace" dialog's own catalog slice. */
  createDialog: FormsMessages['admin']['chrome']['workspaces'];
}

/** Keystrokes settle for this long before the estate is asked (staff only). */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Every workspace the person belongs to, as cards. Open = enter it (the same
 * server action the rail switcher uses: rewrites the cookie and reloads);
 * Manage = the per-workspace page (members + invitations) WITHOUT switching.
 * The search filters client-side by name and, for the deployment's staff,
 * also asks the server after a short debounce: estate workspaces the person
 * never opened here follow under their own heading, Open only (the same staff
 * grant the rail switcher mints). "New workspace" reuses the shared create
 * dialog, which creates + enters in one go.
 *
 * Manage links carry the identity service's workspace id when there is one,
 * so the URL names the workspace the way the Dapta app does.
 */
export function WorkspaceCards({
  workspaces,
  currentAccountId,
  staff = false,
  locale,
  labels,
}: {
  workspaces: Workspace[];
  currentAccountId: string;
  /** Staff of the deployment: the search box also reaches the whole estate. */
  staff?: boolean;
  locale: Locale;
  labels: WorkspaceCardsLabels;
}) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  // Which card is mid-switch, so only that Open button shows the spinner.
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  // Staff: the estate rows for the CURRENT query (stale replies are dropped by
  // the request counter, and a reply for another query is never shown).
  const [results, setResults] = useState<{ q: string; rows: WorkspaceSearchRow[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const requestRef = useRef(0);

  const roleLabel: Record<AccountRole, string> = {
    owner: labels.roleOwner,
    admin: labels.roleAdmin,
    member: labels.roleMember,
  };
  const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  const needle = query.trim().toLocaleLowerCase(locale);
  const visible = needle
    ? workspaces.filter((w) => w.accountName.toLocaleLowerCase(locale).includes(needle))
    : workspaces;

  useEffect(() => {
    if (!staff || !needle) {
      setSearching(false);
      requestRef.current += 1;
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
  }, [staff, needle]);

  // Estate rows: workspaces the caller holds no local row in (the server
  // already leaves out the own list). Anything that DOES carry a local id is a
  // workspace of theirs the page list somehow missed; it is shown among the
  // own cards only if it is not there already.
  const estate = useMemo(() => {
    if (!staff || !needle || !results || results.q !== needle) return [];
    const seen = new Set<string>();
    const out: WorkspaceSearchRow[] = [];
    for (const r of results.rows) {
      if (r.accountId || !r.workspaceId || seen.has(r.workspaceId)) continue;
      seen.add(r.workspaceId);
      out.push(r);
    }
    return out;
  }, [staff, needle, results]);
  const nothingFound =
    !!needle && visible.length === 0 && (!staff || (!searching && estate.length === 0));

  function open(accountId: string) {
    if (accountId === currentAccountId || pending) return;
    setOpeningId(accountId);
    start(async () => {
      const res = await callAction(() => switchWorkspaceAction(accountId));
      // A successful switch REDIRECTS. Next rejects the action promise with its
      // NEXT_REDIRECT error while the router navigates, and callAction hands
      // that back as a transport error: not a failure, so keep the spinner and
      // let the navigation land (this component unmounts with it).
      if (isTransportError(res) && res.message === 'NEXT_REDIRECT') return;
      setOpeningId(null);
      if (isTransportError(res)) toast.error(labels.openErrorFailed);
      else if (res.error) toast.error(res.error === 'forbidden' ? labels.openErrorForbidden : labels.openErrorFailed);
    });
  }

  // Staff only: enter an estate workspace (the API mints the grant, projects
  // it, remembers the choice). Same redirect dance as `open`.
  function openEstate(workspaceId: string) {
    if (pending) return;
    setOpeningId(workspaceId);
    start(async () => {
      const res = await callAction(() => enterEstateWorkspaceAction(workspaceId));
      if (isTransportError(res) && res.message === 'NEXT_REDIRECT') return;
      setOpeningId(null);
      if (isTransportError(res)) toast.error(labels.openErrorFailed);
      else if (res.error) toast.error(res.error === 'forbidden' ? labels.openErrorForbidden : labels.openErrorFailed);
    });
  }

  const manageHref = (w: Workspace) => `/admin/account/workspaces/${w.workspaceId ?? w.accountId}`;

  // The whole card is a way into Manage, not only its button: people click the
  // card, and a card that answers with nothing reads as broken. Pointer only,
  // on purpose: the Manage link inside is already the keyboard and screen
  // reader way in, and giving the <li> a role or a tab stop would either nest
  // interactive content inside a link or take the list's semantics away. Two
  // things are NOT a card click: the action row (Open must stay Open, so it
  // stops the event before it gets here), and a text selection (someone
  // copying the workspace code should not be navigated away mid-drag).
  function cardClick(w: Workspace) {
    if (window.getSelection()?.toString()) return;
    router.push(manageHref(w));
  }

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">{labels.title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{labels.subtitle}</p>
        </div>
        <Button size="sm" data-testid="workspace-new" onClick={() => setCreating(true)}>
          <i aria-hidden className="pi pi-plus" style={{ fontSize: 12 }} /> {labels.newWorkspace}
        </Button>
      </div>

      {workspaces.length > 0 || staff ? (
        <label className="relative mt-5 block max-w-sm">
          <i
            aria-hidden
            className="pi pi-search pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            style={{ fontSize: 13 }}
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={labels.search}
            aria-label={labels.search}
            autoComplete="off"
            data-testid="workspace-search"
            className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      ) : null}

      <div className="mt-5" data-testid="workspace-cards">
        {workspaces.length === 0 && !needle ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border bg-card/40 p-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <i aria-hidden className="pi pi-th-large" style={{ fontSize: 20 }} />
            </div>
            <p className="text-sm text-muted-foreground">{labels.empty}</p>
          </div>
        ) : nothingFound ? (
          <p
            className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground"
            data-testid="workspace-search-empty"
          >
            {labels.searchEmpty}
          </p>
        ) : visible.length === 0 ? null : (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((w) => {
              const isCurrent = w.accountId === currentAccountId;
              const isOpening = pending && openingId === w.accountId;
              // An invited card offers only Open (accepting is the explicit
              // click, see the note by the buttons), so it has no Manage to
              // navigate to and stays a plain card.
              const clickable = w.status !== 'invited';
              const memberText =
                w.memberCount === 1
                  ? labels.memberOne
                  : t(labels.memberOther, { count: numberFormat.format(w.memberCount) });
              return (
                <li
                  key={w.accountId}
                  data-testid="workspace-card"
                  data-account-id={w.accountId}
                  data-workspace-id={w.workspaceId ?? undefined}
                  onClick={clickable ? () => cardClick(w) : undefined}
                  className={cn(
                    'flex flex-col gap-4 rounded-xl border bg-card p-5 transition-colors',
                    isCurrent ? 'border-primary-edge/60' : 'border-border hover:border-primary-edge/40',
                    clickable && 'cursor-pointer',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/15 text-sm font-semibold text-foreground"
                    >
                      {w.accountName.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="min-w-0 truncate text-base font-semibold tracking-tight" title={w.accountName}>
                          {w.accountName}
                        </span>
                        {isCurrent ? (
                          <span className="shrink-0 rounded-full bg-primary/20 px-2 py-0.5 text-2xs font-medium text-foreground">
                            {labels.current}
                          </span>
                        ) : null}
                        {w.status === 'invited' ? (
                          <span className="shrink-0 rounded-full bg-secondary/15 px-2 py-0.5 text-2xs font-medium text-secondary">
                            {labels.invited}
                          </span>
                        ) : null}
                        {/* In it by the staff grant, not by membership. Same
                            copy as the rail switcher's badge. */}
                        {w.accessGrant === 'staff' ? (
                          <span
                            data-testid="workspace-staff-badge"
                            className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground"
                          >
                            {labels.createDialog.staff}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate font-mono text-xs text-faint" title={w.accountCode}>
                        {w.accountCode}
                      </p>
                    </div>
                  </div>

                  <dl className="flex flex-col gap-1 text-sm">
                    <div className="flex items-center gap-1.5">
                      <dt className="text-faint">{labels.yourRole}:</dt>
                      <dd className="font-medium text-foreground">{roleLabel[w.role]}</dd>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <i aria-hidden className="pi pi-users" style={{ fontSize: 13 }} />
                      <dd>{memberText}</dd>
                    </div>
                  </dl>

                  {/* The action row is its own click target: a click on Open or
                      Manage (or the space between them) never bubbles up as a
                      card click, so Open cannot double as Manage. */}
                  <div
                    className="mt-auto flex items-center gap-2 border-t border-border pt-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      size="sm"
                      data-testid="workspace-open"
                      disabled={isCurrent || pending}
                      onClick={() => open(w.accountId)}
                      className="min-w-[88px]"
                    >
                      {isOpening ? (
                        <i aria-hidden className="pi pi-spinner pi-spin" style={{ fontSize: 12 }} />
                      ) : (
                        <i aria-hidden className="pi pi-arrow-right" style={{ fontSize: 12 }} />
                      )}
                      {labels.open}
                    </Button>
                    {/* An invitation is accepted by ENTERING the workspace (the
                        API activates the membership when a request resolves in
                        it), and Manage resolves in it too. Offer only Open on
                        an invited card, so accepting is always the explicit
                        click, never a side effect of looking. */}
                    {w.status !== 'invited' ? (
                      <Link
                        href={manageHref(w)}
                        data-testid="workspace-manage"
                        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                      >
                        <i aria-hidden className="pi pi-cog" style={{ fontSize: 12 }} />
                        {labels.manage}
                      </Link>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Staff: the estate, under its own heading. Open only: Manage lives
            on the detail page, which lists only workspaces the person holds a
            local row in, and that row is exactly what Open mints. */}
        {staff && needle && (searching || estate.length > 0) ? (
          <section className="mt-8" data-testid="workspace-estate" aria-busy={searching || undefined}>
            <p className="flex items-center gap-2 text-2xs font-medium uppercase tracking-wide text-faint">
              {labels.createDialog.estate}
              {searching ? (
                <span className="inline-flex items-center gap-1 normal-case tracking-normal text-faint">
                  <i aria-hidden className="pi pi-spinner pi-spin" style={{ fontSize: 10 }} />
                  {labels.createDialog.searching}
                </span>
              ) : null}
            </p>
            {estate.length > 0 ? (
              <ul className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {estate.map((r) => {
                  const workspaceId = r.workspaceId as string;
                  const isOpening = pending && openingId === workspaceId;
                  const memberText =
                    r.memberCount === 1
                      ? labels.memberOne
                      : t(labels.memberOther, { count: numberFormat.format(r.memberCount) });
                  return (
                    <li
                      key={workspaceId}
                      data-testid="workspace-card"
                      data-workspace-id={workspaceId}
                      data-estate
                      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary-edge/40"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          aria-hidden
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold text-foreground"
                        >
                          {r.name.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="min-w-0 truncate text-base font-semibold tracking-tight" title={r.name}>
                              {r.name}
                            </span>
                            <span
                              data-testid="workspace-staff-badge"
                              className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground"
                            >
                              {labels.createDialog.staff}
                            </span>
                          </div>
                          {r.hint ? (
                            <p className="mt-0.5 truncate text-xs text-faint" data-testid="workspace-card-hint">
                              {r.hint.kind === 'form' ? t(labels.createDialog.hintForm, { name: r.hint.value }) : r.hint.value}
                            </p>
                          ) : (
                            <p className="mt-0.5 truncate font-mono text-xs text-faint" title={workspaceId}>
                              {workspaceId}
                            </p>
                          )}
                        </div>
                      </div>
                      <dl className="flex flex-col gap-1 text-sm">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <i aria-hidden className="pi pi-users" style={{ fontSize: 13 }} />
                          <dd>{memberText}</dd>
                        </div>
                      </dl>
                      <div className="mt-auto flex items-center gap-2 border-t border-border pt-4">
                        <Button
                          size="sm"
                          data-testid="workspace-open"
                          disabled={pending}
                          onClick={() => openEstate(workspaceId)}
                          className="min-w-[88px]"
                        >
                          {isOpening ? (
                            <i aria-hidden className="pi pi-spinner pi-spin" style={{ fontSize: 12 }} />
                          ) : (
                            <i aria-hidden className="pi pi-arrow-right" style={{ fontSize: 12 }} />
                          )}
                          {labels.open}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        ) : null}
      </div>

      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} m={labels.createDialog} />
    </section>
  );
}
