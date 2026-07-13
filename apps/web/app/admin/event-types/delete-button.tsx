'use client';

import { useState, useTransition } from 'react';
import { useToast } from '@/components/toast';
import { deleteEventTypeAction } from './actions';

export function DeleteButton({ id }: { id: string }) {
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
              const r = await deleteEventTypeAction(id);
              setConfirming(false);
              if (r.ok) success('Event deleted.');
              else error(r.message ?? 'Could not delete the event.');
            })
          }
          className="rounded-md border border-destructive px-2 py-1 text-destructive disabled:opacity-60"
        >
          Delete
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-border px-2 py-1">
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="rounded-md border border-border px-3 py-1 text-sm text-muted-foreground transition-transform active:scale-[0.97] hover:border-destructive hover:text-destructive"
    >
      Delete
    </button>
  );
}
