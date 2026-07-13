'use client';

import { useState, useTransition } from 'react';
import type { BookingMessages } from '@slate/shared';
import { useToast } from '@/components/toast';
import { cancelBookingAction, confirmBookingAction, declineBookingAction } from './actions';

type BookingsMessages = BookingMessages['admin']['bookings'];

export function PendingActions({ uid, m }: { uid: string; m: BookingsMessages }) {
  const [pending, start] = useTransition();
  const { success, error } = useToast();
  const run = (fn: (u: string) => Promise<{ ok: boolean; message?: string }>, ok: string) =>
    start(async () => {
      const r = await fn(uid);
      if (r.ok) success(ok);
      else error(r.message ?? m.genericError);
    });
  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => run(confirmBookingAction, m.confirmedToast)}
        className="rounded-md bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
      >
        {m.confirm}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(declineBookingAction, m.declinedToast)}
        className="rounded-md border border-destructive px-3 py-1 text-sm text-destructive transition-transform active:scale-[0.98] disabled:opacity-60"
      >
        {m.decline}
      </button>
    </div>
  );
}

export function CancelAction({ uid, m }: { uid: string; m: BookingsMessages }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const { success, error } = useToast();

  const doCancel = () =>
    start(async () => {
      const r = await cancelBookingAction(uid);
      setConfirming(false);
      if (r.ok) success(m.cancelledToast);
      else error(r.message ?? m.cancelError);
    });

  return (
    <div className="flex items-center justify-end">
      {confirming ? (
        <span className="flex items-center gap-1 text-sm">
          <span className="text-muted-foreground">{m.cancelPrompt}</span>
          <button
            type="button"
            disabled={pending}
            onClick={doCancel}
            className="rounded-md border border-destructive px-2 py-1 text-destructive disabled:opacity-60"
          >
            {m.yes}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-border px-2 py-1">
            {m.no}
          </button>
        </span>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(true)}
          className="rounded-md border border-border px-3 py-1 text-sm text-muted-foreground transition-transform active:scale-[0.98] hover:border-destructive hover:text-destructive disabled:opacity-60"
        >
          {m.cancel}
        </button>
      )}
    </div>
  );
}
