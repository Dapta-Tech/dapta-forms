'use client';

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { groupSlotsByDay, type BookingMessages, type Slot } from '@slate/shared';
import { cancelAction, rescheduleAction } from './actions';

/** Pull the token out of a (possibly absolute) manageUrl, base-safe. */
function tokenFromUrl(url: string): string | null {
  try {
    return new URL(url, 'http://slate.local').searchParams.get('token');
  } catch {
    return null;
  }
}

export function ManageActions({
  uid,
  token: initialToken,
  slots,
  timeZone,
  messages: m,
}: {
  uid: string;
  token: string;
  slots: Slot[];
  timeZone: string;
  messages: BookingMessages['manage'];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [cancelRes, cancelForm, cancelPending] = useActionState(cancelAction, null);
  const [rsRes, rsForm, rsPending] = useActionState(rescheduleAction, null);
  const [newStartUtc, setNewStartUtc] = useState('');
  // A real reschedule ROTATES the manage token (the one in the URL dies), so we
  // hold the live token in state and adopt the rotated one from the response —
  // otherwise a second cancel/reschedule from this page would 403.
  const [token, setToken] = useState(initialToken);
  const [navPending, startNav] = useTransition();
  const days = useMemo(() => groupSlotsByDay(slots, timeZone), [slots, timeZone]);

  useEffect(() => {
    if (!rsRes) return;
    if (rsRes.ok) {
      // Adopt the fresh token (state + URL) so subsequent actions use it.
      const next = rsRes.manageUrl ? tokenFromUrl(rsRes.manageUrl) : null;
      if (next && next !== token) {
        setToken(next);
        setNewStartUtc('');
        // Preserve any other query params; only swap the token. Wrapped in a
        // transition so the header→new-time RSC round-trip has a pending state.
        const params = new URLSearchParams(searchParams);
        params.set('token', next);
        startNav(() => router.replace(`/manage/${uid}?${params.toString()}`));
      }
    } else {
      // Conflict (slot just taken) → refetch availability, drop the stale time.
      setNewStartUtc('');
      router.refresh();
    }
  }, [rsRes, router, uid, token, searchParams]);

  if (cancelRes?.ok) {
    return (
      <p role="status" aria-live="polite" className="rounded-md border border-border bg-card p-4 text-card-foreground">
        {m.cancelled}
      </p>
    );
  }

  // Reschedule succeeded but no rotated token came back (shouldn't happen on the
  // public path, which always rotates) → the current token is dead, so we can't
  // safely keep the forms live. Show a terminal success instead.
  if (rsRes?.ok && !rsRes.manageUrl) {
    return (
      <p role="status" aria-live="polite" className="rounded-md border border-border bg-card p-4 text-card-foreground">
        {m.rescheduled}
      </p>
    );
  }

  return (
    <div className={`flex flex-col gap-6 ${navPending ? 'opacity-60' : ''}`}>
      {/* Non-terminal success: the token is adopted, so the host can reschedule
          again or cancel from here without a 403. */}
      {rsRes?.ok ? (
        <p role="status" aria-live="polite" className="rounded-md border border-border bg-card p-4 text-card-foreground">
          {m.rescheduled}
        </p>
      ) : null}
      <form action={rsForm} className="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
        <input type="hidden" name="uid" value={uid} />
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="newStartUtc" value={newStartUtc} />
        <span className="text-sm text-muted-foreground">{m.rescheduleTo}</span>
        {days.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.noOpenTimes}</p>
        ) : (
          <div className="flex max-h-64 flex-col gap-3 overflow-y-auto pr-1">
            {days.map((day) => (
              <div key={day.dayKey}>
                <h3 className="mb-1 text-xs font-semibold text-muted-foreground">{day.heading}</h3>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {day.slots.map((s) => (
                    <button
                      key={s.startUtc}
                      type="button"
                      onClick={() => setNewStartUtc(s.startUtc)}
                      aria-pressed={newStartUtc === s.startUtc}
                      className={
                        'rounded-md border px-2 py-1.5 text-xs transition-transform active:scale-[0.98] ' +
                        (newStartUtc === s.startUtc
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background hover:border-primary')
                      }
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {rsRes && !rsRes.ok ? <p role="alert" className="text-sm text-destructive">{rsRes.message}</p> : null}
        <button
          type="submit"
          // Also disable synchronously once a reschedule has succeeded (rsRes.ok)
          // so a fast double-click can't resubmit the stale slot with the rotated
          // (now-dead) token before the effect clears the selection.
          disabled={rsPending || navPending || !newStartUtc || rsRes?.ok}
          className="self-start rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {rsPending ? m.rescheduling : m.reschedule}
        </button>
      </form>

      <form action={cancelForm} className="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
        <input type="hidden" name="uid" value={uid} />
        <input type="hidden" name="token" value={token} />
        <label className="text-sm text-muted-foreground" htmlFor="reason">
          {m.cancelThis}
        </label>
        <input
          id="reason"
          name="reason"
          placeholder={m.cancelReason}
          className="rounded-md border border-input bg-background px-3 py-2"
        />
        {cancelRes && !cancelRes.ok ? (
          <p role="alert" className="text-sm text-destructive">{cancelRes.message}</p>
        ) : null}
        <button
          type="submit"
          disabled={cancelPending}
          className="rounded-md border border-destructive px-4 py-2 font-semibold text-destructive transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {cancelPending ? m.cancelling : m.cancel}
        </button>
      </form>
    </div>
  );
}
