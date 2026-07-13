'use client';

import { useEffect, useMemo, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { commonTimeZones, type BookingMessages } from '@slate/shared';
import type { EventType } from '@/lib/admin-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormHeader } from '@/components/ui/page-header';
import { createHostBookingAction, loadHostSlotsAction } from './actions';

type BookingsMessages = BookingMessages['admin']['bookings'];

/** Interpret a `datetime-local` wall-clock in a SPECIFIC timezone (the attendee's),
 *  not the host browser's — DST-safe two-pass. */
function wallClockToUtc(local: string, tz: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return new Date(local).toISOString();
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const naive = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  const offsetAt = (ms: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(ms));
    const g = Object.fromEntries(parts.map((p) => [p.type, p.value])) as Record<string, string>;
    return Date.UTC(+g.year!, +g.month! - 1, +g.day!, +g.hour!, +g.minute!, +g.second!) - ms;
  };
  let ms = naive - offsetAt(naive);
  ms = naive - offsetAt(ms);
  return new Date(ms).toISOString();
}

/**
 * The slot list's empty state. A configuration error (reason code from the
 * API) renders an actionable notice with ONE inline link to where it's fixed
 * — never the misleading bare "No slots in range." a genuinely empty window
 * gets. Detail like this is admin-only; public pages stay generic.
 */
function EmptySlotsNotice({
  issue,
  eventId,
  m,
}: {
  issue: string | null;
  eventId?: string;
  m: BookingsMessages;
}) {
  if (!issue) {
    return <span className="col-span-full text-sm text-muted-foreground">{m.noSlotsRange}</span>;
  }
  const byIssue: Record<string, { text: string; href: string; link: string }> = {
    SCHEDULE_MISSING: {
      text: m.scheduleMissingNotice,
      href: eventId ? `/admin/event-types/${eventId}` : '/admin/event-types',
      link: m.scheduleMissingLink,
    },
    NO_HOURS: { text: m.noHoursNotice, href: '/admin/availability', link: m.availabilityLink },
    NO_SCHEDULE: { text: m.noScheduleNotice, href: '/admin/availability', link: m.availabilityLink },
    CALENDAR_UNAVAILABLE: {
      text: m.calendarUnavailableNotice,
      href: '/admin/connections',
      link: m.calendarUnavailableLink,
    },
  };
  const notice = byIssue[issue];
  if (!notice) {
    // LOAD_FAILED or an unknown future code: an honest error, not "no slots".
    return <span className="col-span-full text-sm text-destructive">{m.slotsLoadError}</span>;
  }
  return (
    <span className="col-span-full flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      <span>{notice.text}</span>
      <Link href={notice.href} className="w-fit font-medium underline underline-offset-4">
        {notice.link}
      </Link>
    </span>
  );
}

export function HostBookingForm({
  handle,
  eventTypes,
  messages: m,
  backHref,
  backLabel,
  heading,
  notice,
}: {
  /** The member's public handle, if set. Manual bookings work without one —
   *  slots and booking go through the authenticated host surface. */
  handle?: string;
  eventTypes: EventType[];
  messages: BookingsMessages;
  backHref: string;
  backLabel: string;
  heading: string;
  /** Optional banner rendered between the header and the form (e.g. the
   *  no-public-handle notice). */
  notice?: ReactNode;
}) {
  // Only offer bookable (non-hidden) events.
  const bookable = useMemo(() => eventTypes.filter((e) => !e.hidden), [eventTypes]);
  const [slug, setSlug] = useState(bookable[0]?.slug ?? '');
  const [mode, setMode] = useState<'slots' | 'any'>('slots');
  const [slots, setSlots] = useState<string[]>([]);
  // Why the slot list is empty: a config-error reason code from the API, or
  // 'LOAD_FAILED' when the request itself failed — each gets distinct copy.
  const [slotsIssue, setSlotsIssue] = useState<string | null>(null);
  const [startUtc, setStartUtc] = useState('');
  const [customLocal, setCustomLocal] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [tz, setTz] = useState('America/New_York');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok: boolean; uid?: string; message?: string; status?: number; error?: string } | null>(null);
  const [pending, startT] = useTransition();

  const event = bookable.find((e) => e.slug === slug);
  const fields = (event?.bookingFields ?? []) as Array<{ name: string; label: string; type: string; required: boolean }>;

  // `reloadKey` bumps to force a slots refetch after a 409 (the picked slot was
  // just taken) so the stale/taken time drops out and the user can really retry.
  const [reloadKey, setReloadKey] = useState(0);

  // Load available slots for the chosen event (slots mode) via the
  // authenticated host surface — resolves the member by id, so this works
  // before a public handle is set (the public endpoint 400s without one).
  useEffect(() => {
    if (mode !== 'slots' || !slug) return;
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 21 * 86_400_000).toISOString();
    loadHostSlotsAction(slug, from, to)
      .then((r) => {
        setSlots(r.slots);
        setSlotsIssue(r.ok ? (r.emptyReason ?? null) : 'LOAD_FAILED');
      })
      .catch(() => {
        setSlots([]);
        setSlotsIssue('LOAD_FAILED');
      });
    setStartUtc('');
  }, [mode, slug, reloadKey]);

  const submit = () =>
    startT(async () => {
      const start = mode === 'any' ? (customLocal ? wallClockToUtc(customLocal, tz) : '') : startUtc;
      if (!start) return setResult({ ok: false, message: m.pickTime });
      const r = await createHostBookingAction({
        handle: handle || undefined,
        slug,
        startUtc: start,
        attendee: { name, email, timeZone: tz },
        answers: Object.keys(answers).length ? answers : undefined,
      });
      setResult(r);
      // Slot just taken → drop the stale selection and refetch a fresh list so
      // "pick another slot" is actionable, not a dead end.
      if (!r.ok && r.status === 409 && mode === 'slots') {
        setStartUtc('');
        setReloadKey((k) => k + 1);
      }
    });

  if (result?.ok) {
    return (
      <div className="rounded-md border border-border bg-card p-6">
        <h2 className="mb-2 text-xl font-semibold">{m.createdTitle}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{m.createdNote}</p>
        <Link href="/admin/bookings" className="text-sm text-primary underline underline-offset-4">
          {m.backToBookings}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <FormHeader
        backHref={backHref}
        backLabel={backLabel}
        title={heading}
        actions={
          <Button type="submit" disabled={pending || !name || !email}>
            {pending ? m.creating : m.createBooking}
          </Button>
        }
      />
      {notice}
      <div className="flex flex-col gap-4 rounded-md border border-border bg-card p-6">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{m.eventType}</span>
        <select value={slug} onChange={(e) => setSlug(e.target.value)} className="rounded-md border border-input bg-background px-3 py-2">
          {bookable.map((et) => (
            <option key={et.slug} value={et.slug}>
              {et.title} · {et.lengthMinutes} min
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-2 text-sm">
        <Button variant={mode === 'slots' ? 'default' : 'outline'} size="sm" onClick={() => setMode('slots')}>
          {m.fromSlots}
        </Button>
        <Button variant={mode === 'any' ? 'default' : 'outline'} size="sm" onClick={() => setMode('any')}>
          {m.anyTime}
        </Button>
      </div>

      {mode === 'slots' ? (
        <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
          {slots.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStartUtc(s)}
              aria-pressed={startUtc === s}
              className={
                'rounded-md border px-2 py-2 text-xs ' +
                (startUtc === s ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:border-primary')
              }
            >
              {new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(s))}
            </button>
          ))}
          {slots.length === 0 ? (
            <EmptySlotsNotice issue={slotsIssue} eventId={event?.id} m={m} />
          ) : null}
        </div>
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{m.dateTimeHost}</span>
          <Input type="datetime-local" value={customLocal} onChange={(e) => setCustomLocal(e.target.value)} />
        </label>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{m.attendeeName}</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{m.attendeeEmail}</span>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{m.attendeeTimezone}</span>
        <select
          value={tz}
          onChange={(e) => setTz(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {commonTimeZones(tz).map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </label>

      {fields.map((f) => (
        <label key={f.name} className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {f.label}
            {f.required ? ' *' : ''}
          </span>
          <Input
            required={f.required}
            value={answers[f.name] ?? ''}
            onChange={(e) => setAnswers((a) => ({ ...a, [f.name]: e.target.value }))}
          />
        </label>
      ))}

      {result && !result.ok ? (
        <p className="text-sm text-destructive">
          {result.error === 'CALENDAR_UNAVAILABLE'
            ? m.calendarUnavailableBooking
            : result.status === 409
              ? m.slotTaken
              : result.message}
        </p>
      ) : null}
      </div>
    </form>
  );
}
