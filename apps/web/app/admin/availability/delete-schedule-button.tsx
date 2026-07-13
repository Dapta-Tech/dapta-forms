'use client';

import { useState, useTransition } from 'react';
import type { BookingMessages } from '@slate/shared';
import { useToast } from '@/components/toast';
import { deleteScheduleAction } from './actions';

type AvailabilityMessages = BookingMessages['admin']['availability'];

/** Inline confirm-gated delete for a schedule list row. */
export function DeleteScheduleButton({ id, messages: m }: { id: string; messages: AvailabilityMessages }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const { success, error } = useToast();

  if (confirming) {
    return (
      <span className="flex items-center gap-1 text-sm">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await deleteScheduleAction(id);
              setConfirming(false);
              if (r.ok) success(m.deletedToast);
              else error(r.message ?? m.deleteError);
            })
          }
          className="rounded-md border border-destructive px-2 py-1.5 text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
        >
          {m.yes}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-border px-2 py-1.5 transition-colors hover:bg-accent">
          {m.no}
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
    >
      {m.deleteSchedule}
    </button>
  );
}
