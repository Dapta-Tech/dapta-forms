import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, migrate, seed, sql, createBooking, getAvailability, type Db } from '@slate/db';
import type {
  CalendarProvider,
  CalendarSummary,
  ConnectionHealth,
  CreateEventInput,
  CreatedEvent,
  DeleteEventInput,
  UpdateEventInput,
} from '@slate/calendar';
import { CalendarEffects } from './calendar-effects';

/** A fake provider that records writes, moves AND deletes (the port's effects). */
class RecordingCalendarProvider implements CalendarProvider {
  readonly enabled = true;
  readonly created: CreateEventInput[] = [];
  readonly updated: UpdateEventInput[] = [];
  readonly deleted: DeleteEventInput[] = [];
  private seq = 0;
  listBusy(): Promise<[]> {
    return Promise.resolve([]);
  }
  createEvent(input: CreateEventInput): Promise<CreatedEvent> {
    this.created.push(input);
    return Promise.resolve({ externalEventId: `evt-${++this.seq}`, meetingUrl: 'https://meet/x' });
  }
  updateEvent(input: UpdateEventInput): Promise<CreatedEvent> {
    this.updated.push(input);
    return Promise.resolve({ externalEventId: input.externalEventId, meetingUrl: 'https://meet/x' });
  }
  deleteEvent(input: DeleteEventInput): Promise<void> {
    this.deleted.push(input);
    return Promise.resolve();
  }
  listCalendars(): Promise<CalendarSummary[]> {
    return Promise.resolve([]);
  }
  checkConnection(): Promise<ConnectionHealth> {
    return Promise.resolve({ ok: true, detail: 'Connected' });
  }
}

// Awaitable views of the fire-and-forget effect methods (production callers do
// not await them; tests exercise the same private core deterministically).
type Awaitable = {
  writeEvent(uid: string): Promise<void>;
  removeEvent(uid: string): Promise<void>;
  moveEvent(uid: string): Promise<void>;
};

describe('CalendarEffects — booking lifecycle → CalendarProvider port (E4/B9/C14)', () => {
  let db: Db;
  let accountId: string;
  let memberId: string;
  const CAL_REF = 'cal-dest-1';

  async function bookFirstSlot(): Promise<string> {
    const fromMs = Date.now();
    const toMs = fromMs + 10 * 86_400_000;
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
    if (!booked.ok) throw new Error('seed booking failed');
    return booked.booking.uid;
  }

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    accountId = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code = 'acme'`))!.id;
    memberId = (await db.get<{ id: string }>(
      sql`SELECT id FROM member WHERE handle = 'alex-rivera'`,
    ))!.id;
    // A write-destination calendar for the host.
    await db.run(
      sql`INSERT INTO connected_calendar
            (id, account_id, member_id, provider, external_id, primary_email,
             is_destination, check_conflicts, created_at)
          VALUES (${randomUUID()}, ${accountId}, ${memberId}, ${'google'}, ${CAL_REF}, ${null},
             ${1}, ${1}, ${Date.now()})`,
    );
  });

  it('accept → creates the remote event and persists a booking_reference', async () => {
    const provider = new RecordingCalendarProvider();
    const effects = new CalendarEffects(provider, db);
    const uid = await bookFirstSlot();

    await (effects as unknown as Awaitable).writeEvent(uid);

    expect(provider.created).toHaveLength(1);
    expect(provider.created[0]!.connectionRef).toBe(CAL_REF);
    expect(provider.created[0]!.attendeeEmails).toEqual(['sam@example.com']);
    expect(provider.created[0]!.requestConferenceLink).toBe(false); // location is null, not 'google_meet'

    const refs = await db.all<{ external_event_id: string; meeting_url: string }>(
      sql`SELECT br.external_event_id, br.meeting_url
          FROM booking_reference br JOIN booking b ON b.id = br.booking_id
          WHERE b.uid = ${uid}`,
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]!.external_event_id).toBe('evt-1');
  });

  it('DH1: a retried/concurrent write is idempotent — no duplicate external event', async () => {
    const provider = new RecordingCalendarProvider();
    const effects = new CalendarEffects(provider, db);
    const uid = await bookFirstSlot();

    // Two sequential writes (retry) and two concurrent writes (race) must all
    // collapse to a SINGLE createEvent + a single reference for the destination.
    await (effects as unknown as Awaitable).writeEvent(uid);
    await (effects as unknown as Awaitable).writeEvent(uid);
    await Promise.all([
      (effects as unknown as Awaitable).writeEvent(uid),
      (effects as unknown as Awaitable).writeEvent(uid),
    ]);

    expect(provider.created).toHaveLength(1);
    const refs = await db.all(
      sql`SELECT br.id FROM booking_reference br JOIN booking b ON b.id = br.booking_id
          WHERE b.uid = ${uid} AND br.destination = ${CAL_REF}`,
    );
    expect(refs).toHaveLength(1);
  });

  it('cancel → deletes the remote event and clears the reference', async () => {
    const provider = new RecordingCalendarProvider();
    const effects = new CalendarEffects(provider, db);
    const uid = await bookFirstSlot();
    await (effects as unknown as Awaitable).writeEvent(uid);

    await (effects as unknown as Awaitable).removeEvent(uid);

    expect(provider.deleted).toHaveLength(1);
    expect(provider.deleted[0]!.externalEventId).toBe('evt-1');
    expect(provider.deleted[0]!.connectionRef).toBe(CAL_REF);
    const refs = await db.all(
      sql`SELECT br.id FROM booking_reference br JOIN booking b ON b.id = br.booking_id
          WHERE b.uid = ${uid}`,
    );
    expect(refs).toHaveLength(0);
  });

  it('reschedule → MOVES the same external event in place (no delete, no duplicate)', async () => {
    const provider = new RecordingCalendarProvider();
    const effects = new CalendarEffects(provider, db);
    const uid = await bookFirstSlot();
    await (effects as unknown as Awaitable).writeEvent(uid);
    expect(provider.created).toHaveLength(1);

    await (effects as unknown as Awaitable).moveEvent(uid);

    // The event was UPDATED in place — same external id, nothing deleted, no re-create.
    expect(provider.updated).toHaveLength(1);
    expect(provider.updated[0]!.externalEventId).toBe('evt-1');
    expect(provider.updated[0]!.connectionRef).toBe(CAL_REF);
    expect(provider.created).toHaveLength(1);
    expect(provider.deleted).toHaveLength(0);
    // The single reference row is preserved (still evt-1).
    const refs = await db.all<{ external_event_id: string }>(
      sql`SELECT br.external_event_id FROM booking_reference br JOIN booking b ON b.id = br.booking_id
          WHERE b.uid = ${uid}`,
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]!.external_event_id).toBe('evt-1');
  });

  it('reschedule with nothing created yet falls back to a fresh create', async () => {
    const provider = new RecordingCalendarProvider();
    const effects = new CalendarEffects(provider, db);
    const uid = await bookFirstSlot();

    await (effects as unknown as Awaitable).moveEvent(uid);

    expect(provider.updated).toHaveLength(0);
    expect(provider.created).toHaveLength(1);
  });

  it('B9: requests a conferencing link only when location is exactly "google_meet"', async () => {
    const provider = new RecordingCalendarProvider();
    const effects = new CalendarEffects(provider, db);
    const uid = await bookFirstSlot();
    await db.run(sql`UPDATE booking SET location = 'google_meet' WHERE uid = ${uid}`);

    await (effects as unknown as Awaitable).writeEvent(uid);
    expect(provider.created[0]!.requestConferenceLink).toBe(true);
  });

  it('disabled provider (OSS default) is a strict no-op — no writes, no references', async () => {
    const disabled: CalendarProvider = {
      enabled: false,
      listBusy: () => Promise.resolve([]),
      createEvent: () => {
        throw new Error('must not be called');
      },
      updateEvent: () => {
        throw new Error('must not be called');
      },
      deleteEvent: () => {
        throw new Error('must not be called');
      },
      listCalendars: () => Promise.resolve([]),
      checkConnection: () => Promise.resolve({ ok: false, detail: 'disabled' }),
    };
    const effects = new CalendarEffects(disabled, db);
    const uid = await bookFirstSlot();

    // Fire-and-forget public methods must not throw and must not touch the port.
    effects.onBookingAccepted(uid);
    effects.onBookingCancelled(uid);
    effects.onBookingRescheduled(uid);

    const refs = await db.all(
      sql`SELECT br.id FROM booking_reference br JOIN booking b ON b.id = br.booking_id
          WHERE b.uid = ${uid}`,
    );
    expect(refs).toHaveLength(0);
  });
});
