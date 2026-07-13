import { notFound } from 'next/navigation';
import { getMessages } from '@slate/shared';
import { adminApi, ApiError } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { EventTypeForm } from '../event-type-form';

export const dynamic = 'force-dynamic';

export default async function EditEventType({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // getEventType throws ApiError on 404 (stale/deleted id) — render a clean 404.
  const [et, schedules] = await Promise.all([
    adminApi.getEventType(id).catch((e) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    adminApi.listSchedules(),
  ]);
  if (!et) notFound();
  const msgs = getMessages(await getLocale());
  const m = msgs.admin.eventTypes;

  // Team events get the scheduling-method selector + per-host controls; load the
  // team's members so their names render in the host list.
  const teamMembers = et.teamId
    ? (await adminApi.teamMembers(et.teamId)).map((tm) => ({
        memberId: tm.member_id,
        displayName: tm.display_name,
      }))
    : undefined;

  return (
    <div className="mx-auto max-w-4xl px-8 pb-10">
      <EventTypeForm
        initial={et}
        schedules={schedules}
        messages={m}
        scheduling={et.teamId ? msgs.scheduling : undefined}
        teamMembers={teamMembers}
        backHref="/admin/event-types"
        backLabel={m.title}
        heading={et.title}
      />
    </div>
  );
}
