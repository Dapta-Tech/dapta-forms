import Link from 'next/link';
import { getMessages } from '@slate/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { FormHeader } from '@/components/ui/page-header';
import { HostBookingForm } from './host-booking-form';

export const dynamic = 'force-dynamic';

export default async function NewHostBooking() {
  const [me, eventTypes] = await Promise.all([
    adminApi.me(),
    adminApi.listEventTypes(),
  ]);
  const m = getMessages(await getLocale()).admin.bookings;

  return (
    <div className="mx-auto max-w-2xl px-8 pb-10">
      {eventTypes.length > 0 ? (
        <HostBookingForm
          handle={me?.handle ?? undefined}
          eventTypes={eventTypes}
          messages={m}
          backHref="/admin/bookings"
          backLabel={m.title}
          heading={m.newTitle}
          notice={
            // Manual bookings work without a public handle (the host surface
            // resolves the member by id) — but the missing handle still means
            // the PUBLIC booking page is unpublished, so say it, with the fix
            // one click away. Previously this state silently showed no slots.
            !me?.handle ? (
              <div className="mb-6 flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-4 text-sm">
                <p className="text-muted-foreground">{m.noHandleNotice}</p>
                <Link
                  href="/admin/settings/booking-page"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {m.noHandleLink} →
                </Link>
              </div>
            ) : undefined
          }
        />
      ) : (
        <>
          <FormHeader backHref="/admin/bookings" backLabel={m.title} title={m.newTitle} />
          <p className="text-muted-foreground">{m.createEventFirst}</p>
        </>
      )}
    </div>
  );
}
