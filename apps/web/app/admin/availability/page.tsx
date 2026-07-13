import Link from 'next/link';
import { getMessages } from '@slate/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { PageHeader } from '@/components/ui/page-header';
import { DeleteScheduleButton } from './delete-schedule-button';
import { NewScheduleButton } from './new-schedule-button';

export const dynamic = 'force-dynamic';

export default async function AvailabilityPage() {
  const schedules = await adminApi.listSchedules();
  const admin = getMessages(await getLocale()).admin;
  const m = admin.availability;

  const newButton = <NewScheduleButton messages={m} />;

  return (
    <div className="mx-auto max-w-[1520px] px-8 py-10">
      {/* One CTA per screen: top-right Create only with rows; the empty state
          below owns the sole centered CTA. */}
      <PageHeader
        title={m.title}
        subtitle={m.subtitle}
        action={schedules.length > 0 ? newButton : undefined}
      />

      {schedules.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {schedules.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-4"
            >
              <Link href={`/admin/availability/${s.id}`} className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground" aria-hidden>
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7.5V12l3 2" />
                  </svg>
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium hover:text-primary">{s.name}</span>
                  <span className="truncate text-sm text-muted-foreground">{s.timeZone}</span>
                </span>
              </Link>
              <div className="flex items-center gap-2">
                <Link
                  href={`/admin/availability/${s.id}`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:border-primary"
                >
                  {admin.common.edit}
                </Link>
                <DeleteScheduleButton id={s.id} messages={m} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border p-10 text-center">
          <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5V12l3 2" />
          </svg>
          <p className="max-w-sm text-sm text-muted-foreground">{m.emptyList}</p>
          {newButton}
        </div>
      )}
    </div>
  );
}
