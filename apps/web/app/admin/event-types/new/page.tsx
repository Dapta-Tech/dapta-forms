import { getMessages } from '@slate/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { EventTypeForm } from '../event-type-form';

export const dynamic = 'force-dynamic';

export default async function NewEventType() {
  const [schedules, locale] = await Promise.all([adminApi.listSchedules(), getLocale()]);
  const m = getMessages(locale).admin.eventTypes;

  return (
    <div className="mx-auto max-w-4xl px-8 pb-10">
      <EventTypeForm
        schedules={schedules}
        messages={m}
        redirectOnSuccess="/admin/event-types"
        backHref="/admin/event-types"
        backLabel={m.title}
        heading={m.newEventType}
      />
    </div>
  );
}
