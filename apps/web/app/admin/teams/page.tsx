import Link from 'next/link';
import { getMessages } from '@slate/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { PageHeader } from '@/components/ui/page-header';
import { TeamCard } from './teams-client';

export const dynamic = 'force-dynamic';

export default async function TeamsPage() {
  const [teams, me] = await Promise.all([adminApi.listTeams(), adminApi.me()]);
  const withMembers = await Promise.all(
    teams.map(async (t) => ({ team: t, count: (await adminApi.teamMembers(t.id)).length })),
  );
  const m = getMessages(await getLocale()).admin.teams;
  const accountCode = me?.accountCode ?? '';

  return (
    <div className="mx-auto max-w-[1520px] px-8 py-10">
      {/* One CTA per screen: top-right Create only with rows; the empty state
          owns the sole centered CTA. */}
      <PageHeader
        title={m.title}
        subtitle={m.subtitle}
        action={
          teams.length > 0 ? (
            <Link
              href="/admin/teams/new"
              className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
            >
              {m.newTeam}
            </Link>
          ) : undefined
        }
      />
      {teams.length > 0 ? (
        <div className="flex flex-col gap-3">
          {withMembers.map(({ team, count }) => (
            <TeamCard key={team.id} team={team} memberCount={count} accountCode={accountCode} messages={m} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border p-10 text-center">
          <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground" aria-hidden>
            <circle cx="9" cy="8" r="3.2" />
            <path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 20a5.5 5.5 0 0 0-3-4.9" />
          </svg>
          <p className="max-w-sm text-sm text-muted-foreground">{m.emptyList}</p>
          <Link
            href="/admin/teams/new"
            className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
          >
            {m.newTeam}
          </Link>
        </div>
      )}
    </div>
  );
}
