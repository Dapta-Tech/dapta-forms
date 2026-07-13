import Link from 'next/link';
import { getMessages, t } from '@slate/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { CopyLink } from '@/components/copy-link';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const me = await adminApi.me();
  const [eventTypes, bookings, teams] = await Promise.all([
    adminApi.listEventTypes(),
    adminApi.listBookings('limit=100'),
    adminApi.listTeams(),
  ]);
  const upcoming = bookings.items.filter(
    (b) => b.status === 'accepted' && new Date(b.startUtc).getTime() > Date.now(),
  );
  const publicUrl = me?.handle ? `/${me.accountCode}/${me.handle}` : null;
  const h = getMessages(await getLocale()).admin.home;
  const firstName = me?.displayName?.split(' ')[0];

  return (
    <div className="mx-auto max-w-[1520px] px-8 py-10">
      <h1 className="mb-1 text-3xl font-semibold tracking-tight">
        {firstName ? t(h.welcomeNamed, { name: firstName }) : h.welcome}
      </h1>
      <p className="mb-8 text-muted-foreground">{h.subtitle}</p>

      {/* Every member has an auto-assigned handle (short-links §3), so the
          shareable link always exists — the old "set a handle" nag is gone. */}
      {publicUrl ? (
        <div className="mb-8 flex flex-col gap-2 rounded-md border border-border bg-card p-5">
          <span className="text-sm text-muted-foreground">{h.bookingLink}</span>
          <CopyLink path={publicUrl} labels={{ copy: h.copy, copied: h.copied, open: h.open }} />
        </div>
      ) : null}

      <div className="mb-8 grid grid-cols-3 gap-4">
        <Stat label={h.statEventTypes} value={eventTypes.length} href="/admin/event-types" />
        <Stat label={h.statUpcoming} value={upcoming.length} href="/admin/bookings" />
        <Stat label={h.statTeams} value={teams.length} href="/admin/teams" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Shortcut href="/admin/event-types" title={h.createEvent} desc={h.createEventDesc} />
        <Shortcut href="/admin/availability" title={h.setAvailability} desc={h.setAvailabilityDesc} />
        <Shortcut href="/admin/settings/booking-page" title={h.stylePage} desc={h.stylePageDesc} />
        <Shortcut href="/admin/settings/developer" title={h.apiKeys} desc={h.apiKeysDesc} />
      </div>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-md border border-border bg-card p-5 transition-transform hover:border-primary active:scale-[0.99]"
    >
      <span className="text-3xl font-semibold">{value}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </Link>
  );
}

function Shortcut({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-md border border-border bg-card p-5 transition-transform hover:border-primary active:scale-[0.99]"
    >
      <span className="font-medium">{title}</span>
      <span className="text-sm text-muted-foreground">{desc}</span>
    </Link>
  );
}
