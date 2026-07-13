import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DisabledCalendarProvider, InMemoryCalendarProvider } from '@slate/calendar';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import { seed } from './seed';
import { sql } from 'drizzle-orm';
import { createBooking, getAvailability } from './repository';
import {
  deleteBookingReferences,
  loadBookingForCalendarWrite,
  loadBookingReferences,
  loadConflictConnectionRefs,
  loadDestinationConnectionRefs,
  writeBookingReference,
} from './calendar-refs';

// The CalendarProvider port, wired into the availability + reference paths.
// Everything must be a strict no-op on the OSS default (no connections / disabled
// provider) so a bare clone behaves exactly as before.
describe('calendar-refs (CalendarProvider wiring, SQLite in-memory)', () => {
  let db: Db;
  let accountId: string;
  let memberId: string;
  const CAL_REF = 'cal-ext-1';

  const WINDOW = () => {
    const fromMs = Date.now();
    return { fromMs, toMs: fromMs + 10 * 86_400_000 };
  };

  async function connectCalendar(opts: { destination: boolean; conflicts: boolean }): Promise<void> {
    await db.run(
      sql`INSERT INTO connected_calendar
            (id, account_id, member_id, provider, external_id, primary_email,
             is_destination, check_conflicts, created_at)
          VALUES (${randomUUID()}, ${accountId}, ${memberId}, ${'google'}, ${CAL_REF}, ${null},
             ${opts.destination ? 1 : 0}, ${opts.conflicts ? 1 : 0}, ${Date.now()})`,
    );
  }

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    accountId = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code = 'acme'`))!.id;
    memberId = (await db.get<{ id: string }>(
      sql`SELECT id FROM member WHERE handle = 'alex-rivera'`,
    ))!.id;
  });

  // --- AVAILABILITY: external busy subtracts from offered slots (E4/B9) ------

  it('subtracts external calendar busy times from the offered slots', async () => {
    const { fromMs, toMs } = WINDOW();
    const args = { accountCode: 'acme', handle: 'alex-rivera', slug: 'intro-call', fromMs, toMs };

    // Baseline: no external calendar → local availability only.
    const baseline = await getAvailability(db, args);
    expect(baseline!.slots.length).toBeGreaterThan(1);
    const firstSlot = baseline!.slots[0]!.startUtc;
    const firstStartMs = new Date(firstSlot).getTime();

    // Connect a conflict-checked calendar and mark the first slot's hour BUSY.
    await connectCalendar({ destination: false, conflicts: true });
    const provider = new InMemoryCalendarProvider();
    provider.seedBusy(CAL_REF, [
      { startUtc: new Date(firstStartMs - 60_000).toISOString(), endUtc: new Date(firstStartMs + 60 * 60_000).toISOString() },
    ]);

    const withBusy = await getAvailability(db, args, provider);
    // The busied slot is gone, and strictly fewer slots are offered.
    expect(withBusy!.slots.map((s) => s.startUtc)).not.toContain(firstSlot);
    expect(withBusy!.slots.length).toBeLessThan(baseline!.slots.length);
  });

  it('is a no-op with a disabled provider or no connection (clone-and-run parity)', async () => {
    const { fromMs, toMs } = WINDOW();
    const args = { accountCode: 'acme', handle: 'alex-rivera', slug: 'intro-call', fromMs, toMs };
    const baseline = await getAvailability(db, args);

    // Disabled provider → identical to no provider.
    const disabled = await getAvailability(db, args, new DisabledCalendarProvider());
    expect(disabled!.slots).toEqual(baseline!.slots);

    // Even an ENABLED provider with seeded busy does nothing when the host has no
    // conflict-checked connection — the provider is never consulted.
    const provider = new InMemoryCalendarProvider();
    provider.seedBusy(CAL_REF, [
      { startUtc: new Date(fromMs).toISOString(), endUtc: new Date(toMs).toISOString() },
    ]);
    const noConnection = await getAvailability(db, args, provider);
    expect(noConnection!.slots).toEqual(baseline!.slots);
  });

  // --- CONNECTION REF resolution -------------------------------------------

  it('resolves conflict vs destination connection refs independently', async () => {
    await connectCalendar({ destination: true, conflicts: false });
    expect(await loadConflictConnectionRefs(db, memberId)).toEqual([]);
    expect(await loadDestinationConnectionRefs(db, memberId)).toEqual([CAL_REF]);
  });

  // --- booking_reference persistence (C14) ----------------------------------

  it('loads the write context (destination refs + attendees) and round-trips a reference', async () => {
    await connectCalendar({ destination: true, conflicts: true });
    const { fromMs, toMs } = WINDOW();
    const avail = await getAvailability(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      fromMs,
      toMs,
    });
    const startMs = new Date(avail!.slots[0]!.startUtc).getTime();
    const booked = await createBooking(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      startMs,
      attendee: { name: 'Sam Guest', email: 'sam@example.com', timeZone: 'America/New_York' },
      answers: { company: 'Acme' },
    });
    expect(booked.ok).toBe(true);
    if (!booked.ok) return;

    const ctx = await loadBookingForCalendarWrite(db, booked.booking.uid);
    expect(ctx).not.toBeNull();
    expect(ctx!.destinationRefs).toEqual([CAL_REF]);
    expect(ctx!.attendeeEmails).toEqual(['sam@example.com']);
    expect(ctx!.organizerEmail).toBe('alex@example.com');

    // Persist a reference, read it back, then clear it (the cancel path).
    await writeBookingReference(db, {
      bookingId: ctx!.bookingId,
      type: 'calendar_event',
      externalEventId: 'evt-123',
      externalCalendarId: CAL_REF,
      meetingUrl: 'https://meet.example/xyz',
    });
    const refs = await loadBookingReferences(db, ctx!.bookingId);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.externalEventId).toBe('evt-123');
    expect(refs[0]!.meetingUrl).toBe('https://meet.example/xyz');

    await deleteBookingReferences(db, ctx!.bookingId);
    expect(await loadBookingReferences(db, ctx!.bookingId)).toHaveLength(0);
  });
});
