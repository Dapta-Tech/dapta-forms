'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import type { FormsMessages, Locale } from '@quill/shared';
import { t } from '@quill/shared';
import type { AccountRole, Workspace } from '@/lib/admin-api';
import { switchWorkspaceAction } from '@/app/admin/workspace-actions';
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

/**
 * Every workspace the person belongs to, as cards. Open = enter it (the same
 * server action the rail switcher uses: rewrites the cookie and reloads);
 * Manage = the per-workspace page (members + invitations) WITHOUT switching.
 * The search filters client-side by name; "New workspace" reuses the shared
 * create dialog, which creates + enters in one go.
 */
export function WorkspaceCards({
  workspaces,
  currentAccountId,
  locale,
  labels,
}: {
  workspaces: Workspace[];
  currentAccountId: string;
  locale: Locale;
  labels: WorkspaceCardsLabels;
}) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  // Which card is mid-switch, so only that Open button shows the spinner.
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();

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

      {workspaces.length > 0 ? (
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
        {workspaces.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border bg-card/40 p-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <i aria-hidden className="pi pi-th-large" style={{ fontSize: 20 }} />
            </div>
            <p className="text-sm text-muted-foreground">{labels.empty}</p>
          </div>
        ) : visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
            {labels.searchEmpty}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((w) => {
              const isCurrent = w.accountId === currentAccountId;
              const isOpening = pending && openingId === w.accountId;
              const memberText =
                w.memberCount === 1
                  ? labels.memberOne
                  : t(labels.memberOther, { count: numberFormat.format(w.memberCount) });
              return (
                <li
                  key={w.accountId}
                  data-testid="workspace-card"
                  data-account-id={w.accountId}
                  className={cn(
                    'flex flex-col gap-4 rounded-xl border bg-card p-5 transition-colors',
                    isCurrent ? 'border-primary-edge/60' : 'border-border hover:border-primary-edge/40',
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

                  <div className="mt-auto flex items-center gap-2 border-t border-border pt-4">
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
                        href={`/admin/account/workspaces/${w.accountId}`}
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
      </div>

      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} m={labels.createDialog} />
    </section>
  );
}
