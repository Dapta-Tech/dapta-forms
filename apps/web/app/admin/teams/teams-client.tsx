'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import type { BookingMessages } from '@slate/shared';
import type { Team } from '@/lib/admin-api';
import { deleteTeamAction } from './actions';

type TeamsMessages = BookingMessages['admin']['teams'];

const monogram = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase() || 'T';

/** Clean list row: logo/monogram + name→detail + member count + public-URL line,
 *  with obvious Manage and a confirm-gated Delete. Member editing lives on the
 *  detail page. */
export function TeamCard({
  team,
  memberCount,
  accountCode,
  messages: m,
}: {
  team: Team;
  memberCount: number;
  accountCode: string;
  messages: TeamsMessages;
}) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const publicPath = accountCode && team.slug ? `/${accountCode}/team/${team.slug}` : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-4">
      <Link href={`/admin/teams/${team.id}`} className="flex min-w-0 items-center gap-3">
        {team.logoUrl ? (
          <img src={team.logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-md border border-border object-cover" />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold text-foreground">
            {monogram(team.name)}
          </span>
        )}
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium hover:text-primary">{team.name}</span>
          <span className="truncate text-sm text-muted-foreground">
            /{team.slug} · {memberCount} {memberCount === 1 ? m.memberSingular : m.memberPlural}
          </span>
          {publicPath ? <span className="truncate text-xs text-muted-foreground">{publicPath}</span> : null}
        </span>
      </Link>
      <div className="flex items-center gap-2">
        <Link
          href={`/admin/teams/${team.id}`}
          className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:border-primary"
        >
          {m.manage}
        </Link>
        {confirming ? (
          <span className="flex items-center gap-1 text-sm">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await deleteTeamAction(team.id);
                  if (!r.ok) setErr(r.message ?? m.deleteError);
                  setConfirming(false);
                })
              }
              className="rounded-md border border-destructive px-2 py-1 text-destructive disabled:opacity-60"
            >
              {m.delete}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-border px-2 py-1">
              {m.cancel}
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
          >
            {m.delete}
          </button>
        )}
      </div>
      {err ? <p className="w-full text-xs text-destructive">{err}</p> : null}
    </div>
  );
}
