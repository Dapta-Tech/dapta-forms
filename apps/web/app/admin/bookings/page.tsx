import Link from 'next/link';
import { getMessages, type BookingMessages } from '@slate/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { PageHeader } from '@/components/ui/page-header';
import { CancelAction, PendingActions } from './booking-actions';

export const dynamic = 'force-dynamic';

type BookingsMessages = BookingMessages['admin']['bookings'];
type Row = { uid: string; status: string; title: string; startUtc: string };

/** Localized label for a raw booking status string. */
function statusLabel(status: string, m: BookingsMessages): string {
  switch (status) {
    case 'accepted':
      return m.statusAccepted;
    case 'pending':
      return m.statusPending;
    case 'cancelled':
      return m.statusCancelled;
    case 'rejected':
      return m.statusRejected;
    default:
      return status;
  }
}

export default async function BookingsPage() {
  const [{ items }, me] = await Promise.all([
    adminApi.listBookings('limit=200'),
    adminApi.me(),
  ]);
  const tz = me?.timeZone ?? 'UTC';
  const m = getMessages(await getLocale()).admin.bookings;
  const now = Date.now();
  const pending = items.filter((b) => b.status === 'pending');
  const upcoming = items.filter((b) => b.status === 'accepted' && new Date(b.startUtc).getTime() > now);
  const past = items.filter(
    (b) => b.status !== 'pending' && !(b.status === 'accepted' && new Date(b.startUtc).getTime() > now),
  );

  return (
    <div className="mx-auto max-w-[1520px] px-8 py-10">
      <PageHeader
        title={m.title}
        action={
          <Link
            href="/admin/bookings/new"
            className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
          >
            {m.newBooking}
          </Link>
        }
      />

      {pending.length > 0 ? (
        <Section title={`${m.pendingConfirmation} (${pending.length})`} rows={pending} action="pending" timeZone={tz} m={m} />
      ) : null}
      <Section title={`${m.upcoming} (${upcoming.length})`} rows={upcoming} action="cancel" timeZone={tz} m={m} />
      <Section title={`${m.pastCancelled} (${past.length})`} rows={past} muted timeZone={tz} m={m} />
    </div>
  );
}

function Section({
  title,
  rows,
  muted,
  action,
  timeZone,
  m,
}: {
  title: string;
  rows: Row[];
  muted?: boolean;
  action?: 'pending' | 'cancel';
  timeZone: string;
  m: BookingsMessages;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{title}</h2>
      {rows.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="4.5" width="18" height="16" rx="2" />
            <path d="M3 9h18M8 2.5v4M16 2.5v4" />
          </svg>
          {m.nothingHere}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((b) => (
            <li
              key={b.uid}
              className={`flex items-center justify-between rounded-md border border-border bg-card p-4 ${
                muted ? 'opacity-70' : ''
              }`}
            >
              <span className="flex flex-col">
                <span className="font-medium">{b.title}</span>
                <span className="text-sm text-muted-foreground">
                  {new Intl.DateTimeFormat('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZone,
                    timeZoneName: 'short',
                  }).format(new Date(b.startUtc))}
                </span>
              </span>
              <div className="flex items-center gap-3">
                {action === 'pending' ? <PendingActions uid={b.uid} m={m} /> : null}
                {action === 'cancel' ? <CancelAction uid={b.uid} m={m} /> : null}
                <span
                  className={`rounded-sm px-2 py-1 text-xs ${
                    b.status === 'accepted'
                      ? 'bg-primary text-primary-foreground'
                      : b.status === 'pending'
                        ? 'bg-secondary text-secondary-foreground'
                        : b.status === 'cancelled' || b.status === 'rejected'
                          ? 'bg-destructive text-destructive-foreground'
                          : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {statusLabel(b.status, m)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
