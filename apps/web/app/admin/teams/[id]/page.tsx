import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getMessages, schedulingMethodLabel } from '@slate/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { FormHeader } from '@/components/ui/page-header';
import { TeamMembersPanel } from '../team-members-panel';

export const dynamic = 'force-dynamic';

export default async function TeamDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, teams] = await Promise.all([
    adminApi.me(),
    adminApi.listTeams(),
  ]);
  const team = teams.find((t) => t.id === id);
  if (!team) notFound();
  const [members, eventTypes] = await Promise.all([
    adminApi.teamMembers(id),
    adminApi.teamEventTypes(id),
  ]);
  const msgs = getMessages(await getLocale());
  const m = msgs.admin.teams;

  return (
    <div className="mx-auto max-w-[1520px] px-8 pb-10">
      <FormHeader
        backHref="/admin/teams"
        backLabel={m.title}
        title={team.name}
        actions={
          me?.accountCode && team.slug ? (
            <Link
              href={`/${me.accountCode}/team/${team.slug}`}
              className="inline-flex min-h-[44px] items-center rounded-md border border-border px-3 py-2 text-sm transition-colors hover:border-primary"
            >
              {m.viewPublicTeam}
            </Link>
          ) : undefined
        }
      />
      <p className="mb-6 -mt-2 text-sm text-muted-foreground">/{team.slug}</p>

      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
        {m.members} <span className="font-normal">({members.length})</span>
      </h2>
      <div className="mb-8">
        <TeamMembersPanel teamId={team.id} members={members} messages={m} />
      </div>

      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{m.teamEventTypes}</h2>
      <ul className="flex flex-col gap-2">
        {eventTypes.map((et) => (
          <li key={et.id} className="flex items-center justify-between rounded-md border border-border bg-card p-4">
            <span className="flex flex-col">
              <span className="font-medium">{et.title}</span>
              <span className="text-sm text-muted-foreground">
                /{et.slug} · {et.lengthMinutes} min · {schedulingMethodLabel(msgs, et.schedulingType)}
              </span>
            </span>
          </li>
        ))}
        {eventTypes.length === 0 ? (
          <li className="text-sm text-muted-foreground">{m.noTeamEventTypes}</li>
        ) : null}
      </ul>
    </div>
  );
}
