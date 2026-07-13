'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { BookingMessages } from '@slate/shared';
import { useToast } from '@/components/toast';
import { createScheduleAction } from './actions';

type AvailabilityMessages = BookingMessages['admin']['availability'];

/**
 * Create-a-schedule in ONE step: there's no separate "name it" screen — this
 * creates a schedule pre-seeded with Mon–Fri 09:00–17:00 and drops you straight
 * into its editor, where you rename and adjust hours. (Felipe: two screens for
 * this made no sense.)
 */
export function NewScheduleButton({ messages: m }: { messages: AvailabilityMessages }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { error } = useToast();

  const create = () =>
    start(async () => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const r = await createScheduleAction(m.newSchedule, tz);
      if (r.ok && r.id) router.push(`/admin/availability/${r.id}`);
      else error(r.message ?? m.saveError);
    });

  return (
    <button
      type="button"
      onClick={create}
      disabled={pending}
      className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:bg-muted disabled:text-muted-foreground"
    >
      {pending ? m.saving : m.newSchedule}
    </button>
  );
}
