import { describe, it, expect, beforeEach } from 'vitest';
import {
  DisabledCalendarProvider,
  InMemoryCalendarProvider,
  type BusyInterval,
  type CalendarProvider,
  type CalendarSummary,
  type ConnectionHealth,
  type CreatedEvent,
} from '@slate/calendar';
import { randomUUID } from 'node:crypto';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import { seed } from './seed';
import { sql } from 'drizzle-orm';
import { createBooking, getAvailability } from './repository';
import {
  createTeamBooking,
  getTeamAvailability,
  listConnections,
  recordConnectionHealth,
  rescheduleBooking,
} from './parity';
import { deleteSchedule } from './crud';

/** Enabled provider whose busy-fetch always fails (vendor outage / revoked auth). */
class FailingCalendarProvider implements CalendarProvider {
  readonly enabled = true;
  listBusy(): Promise<BusyInterval[]> {
    return Promise.reject(new Error('vendor 503'));
  }
  createEvent(): Promise<CreatedEvent> {
    return Promise.reject(new Error('vendor 503'));
  }
  updateEvent(): Promise<CreatedEvent> {
    return Promise.reject(new Error('vendor 503'));
  }
  deleteEvent(): Promise<void> {
    return Promise.reject(new Error('vendor 503'));
  }
  listCalendars(): Promise<CalendarSummary[]> {
    return Promise.resolve([]);
  }
  checkConnection(): Promise<ConnectionHealth> {
    return Promise.resolve({ ok: false, detail: 'Reauthorization required' });
  }
}

// Every configuration failure used to collapse to a silent `slots: []`. These
// specs pin the machine-readable emptyReason per failure mode, the fail-closed
// external-calendar policy, and the schedule-delete guard (no dangling refs).
describe('error visibility (SQLite in-memory)', () => {
  let db: Db;
  let accountId: string;
  let memberId: string;
  let scheduleId: string;
  const CAL_REF = 'cal-ext-1';

  const WINDOW = () => {
    const fromMs = Date.now();
    return { fromMs, toMs: fromMs + 10 * 86_400_000 };
  };
  const ARGS = () => ({ accountCode: 'acme', handle: 'alex-rivera', slug: 'intro-call', ...WINDOW() });

  async function connectConflictCalendar(forMemberId?: string, ref = CAL_REF): Promise<void> {
    await db.run(
      sql`INSERT INTO connected_calendar
            (id, account_id, member_id, provider, external_id, is_destination, check_conflicts, created_at)
          VALUES (${randomUUID()}, ${accountId}, ${forMemberId ?? memberId}, ${'google'}, ${ref}, 0, 1, ${Date.now()})`,
    );
  }

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    accountId = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code = 'acme'`))!.id;
    memberId = (await db.get<{ id: string }>(sql`SELECT id FROM member WHERE handle = 'alex-rivera'`))!.id;
    scheduleId = (await db.get<{ schedule_id: string }>(
      sql`SELECT schedule_id FROM event_type WHERE slug = 'intro-call'`,
    ))!.schedule_id;
  });

  // --- Failure mode 1: dangling schedule reference --------------------------

  it('SCHEDULE_MISSING when the event points at a deleted schedule and no fallback exists', async () => {
    await db.run(sql`UPDATE event_type SET schedule_id = ${'gone-' + randomUUID()} WHERE slug = 'intro-call'`);
    await db.run(sql`UPDATE member SET default_schedule_id = NULL WHERE id = ${memberId}`);
    const r = await getAvailability(db, ARGS());
    expect(r!.slots).toEqual([]);
    expect(r!.emptyReason).toBe('SCHEDULE_MISSING');
  });

  it('a dangling reference with a WORKING member default still offers slots (fallback, no reason)', async () => {
    await db.run(sql`UPDATE event_type SET schedule_id = ${'gone-' + randomUUID()} WHERE slug = 'intro-call'`);
    await db.run(sql`UPDATE member SET default_schedule_id = ${scheduleId} WHERE id = ${memberId}`);
    const r = await getAvailability(db, ARGS());
    expect(r!.slots.length).toBeGreaterThan(0);
    expect(r!.emptyReason).toBeUndefined();
  });

  // --- Failure mode 2: schedule exists but has zero rules --------------------

  it('NO_HOURS when the resolved schedule has no availability rules', async () => {
    await db.run(sql`DELETE FROM availability WHERE schedule_id = ${scheduleId}`);
    const r = await getAvailability(db, ARGS());
    expect(r!.slots).toEqual([]);
    expect(r!.emptyReason).toBe('NO_HOURS');
  });

  // --- Failure mode 3: no schedule at all ------------------------------------

  it('NO_SCHEDULE when neither the event nor the member has a schedule', async () => {
    await db.run(sql`UPDATE event_type SET schedule_id = NULL WHERE slug = 'intro-call'`);
    await db.run(sql`UPDATE member SET default_schedule_id = NULL WHERE id = ${memberId}`);
    const r = await getAvailability(db, ARGS());
    expect(r!.slots).toEqual([]);
    expect(r!.emptyReason).toBe('NO_SCHEDULE');
  });

  // --- Failure mode 5: external calendar unreadable → fail-closed ------------

  it('CALENDAR_UNAVAILABLE (no 500, no silent slots) when the busy-fetch fails', async () => {
    await connectConflictCalendar();
    const r = await getAvailability(db, ARGS(), new FailingCalendarProvider());
    expect(r!.slots).toEqual([]);
    expect(r!.emptyReason).toBe('CALENDAR_UNAVAILABLE');
  });

  it('booking create is fail-closed: unreadable calendar blocks, busy calendar rejects the slot', async () => {
    const free = await getAvailability(db, ARGS());
    const startUtc = free!.slots[0]!.startUtc;
    const book = (calendar?: CalendarProvider) =>
      createBooking(
        db,
        {
          accountCode: 'acme',
          handle: 'alex-rivera',
          slug: 'intro-call',
          startMs: new Date(startUtc).getTime(),
          attendee: { name: 'Sam Guest', email: 'sam@example.com', timeZone: 'America/New_York' },
          answers: { company: 'Acme' },
        },
        calendar,
      );

    await connectConflictCalendar();
    // Unreadable external calendar → visible CALENDAR_UNAVAILABLE, nothing booked.
    expect(await book(new FailingCalendarProvider())).toEqual({ ok: false, reason: 'CALENDAR_UNAVAILABLE' });
    // External conflict that appeared after the availability read → SLOT_TAKEN.
    const busyProvider = new InMemoryCalendarProvider();
    busyProvider.seedBusy(CAL_REF, [
      { startUtc, endUtc: new Date(new Date(startUtc).getTime() + 30 * 60_000).toISOString() },
    ]);
    expect(await book(busyProvider)).toEqual({ ok: false, reason: 'SLOT_TAKEN' });
    // Healthy path still books.
    expect((await book(new DisabledCalendarProvider())).ok).toBe(true);
  });

  it('reschedule is fail-closed like create: busy calendar rejects the target, unreadable blocks the move', async () => {
    const free = await getAvailability(db, ARGS());
    const startUtc = free!.slots[0]!.startUtc;
    const targetUtc = free!.slots[8]!.startUtc;
    const targetMs = new Date(targetUtc).getTime();
    const created = await createBooking(
      db,
      {
        accountCode: 'acme',
        handle: 'alex-rivera',
        slug: 'intro-call',
        startMs: new Date(startUtc).getTime(),
        attendee: { name: 'Sam Guest', email: 'sam@example.com', timeZone: 'America/New_York' },
        answers: { company: 'Acme' },
      },
      new DisabledCalendarProvider(),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const { uid } = created.booking;
    const token = created.manageToken;
    const move = (calendar: CalendarProvider) =>
      rescheduleBooking(db, { uid, newStartMs: targetMs, manageToken: token }, calendar);

    await connectConflictCalendar();

    // Unreadable external calendar → the move is blocked VISIBLY, never applied blind.
    expect(await move(new FailingCalendarProvider())).toEqual({
      ok: false,
      reason: 'CALENDAR_UNAVAILABLE',
    });

    // External conflict at the target slot → rejected as taken (double-booking averted).
    const busyProvider = new InMemoryCalendarProvider();
    busyProvider.seedBusy(CAL_REF, [
      { startUtc: targetUtc, endUtc: new Date(targetMs + 30 * 60_000).toISOString() },
    ]);
    expect(await move(busyProvider)).toEqual({ ok: false, reason: 'SLOT_TAKEN' });

    // Both rejections left the booking at its ORIGINAL time.
    const row = await db.get<{ start_ms: number }>(sql`SELECT start_ms FROM booking WHERE uid = ${uid}`);
    expect(Number(row!.start_ms)).toBe(new Date(startUtc).getTime());

    // A readable, conflict-free calendar lets the same move through.
    const moved = await move(new InMemoryCalendarProvider());
    expect(moved.ok).toBe(true);
  });

  // --- Failure mode 6: genuine emptiness stays reason-less --------------------

  it('a genuinely empty window (out of hours) has NO emptyReason', async () => {
    // The seeded rules are Mon–Fri: probe a far-future Saturday (UTC-safe margin).
    const saturday = new Date('2027-03-06T10:00:00Z').getTime(); // a Saturday
    const r = await getAvailability(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      fromMs: saturday,
      toMs: saturday + 6 * 3600_000,
    });
    expect(r!.slots).toEqual([]);
    expect(r!.emptyReason).toBeUndefined();
  });

  // --- Prevention: schedule delete never leaves dangling references ----------

  it('deleteSchedule re-points event types and the member default instead of dangling', async () => {
    // A second schedule that will survive and catch the member default.
    const keepId = randomUUID();
    await db.run(
      sql`INSERT INTO schedule (id, account_id, member_id, name, time_zone, created_at)
          VALUES (${keepId}, ${accountId}, ${memberId}, ${'Backup Hours'}, ${'America/New_York'}, ${Date.now()})`,
    );
    await db.run(sql`UPDATE member SET default_schedule_id = ${scheduleId} WHERE id = ${memberId}`);

    await deleteSchedule(db, accountId, scheduleId);

    const et = await db.get<{ schedule_id: string | null }>(
      sql`SELECT schedule_id FROM event_type WHERE slug = 'intro-call'`,
    );
    expect(et!.schedule_id).toBeNull();
    const m = await db.get<{ default_schedule_id: string | null }>(
      sql`SELECT default_schedule_id FROM member WHERE id = ${memberId}`,
    );
    expect(m!.default_schedule_id).toBe(keepId);
    expect(await db.get(sql`SELECT id FROM schedule WHERE id = ${scheduleId}`)).toBeUndefined();
  });

  it('deleting the ONLY schedule nulls the member default (and the read path reports NO_SCHEDULE)', async () => {
    await db.run(sql`UPDATE member SET default_schedule_id = ${scheduleId} WHERE id = ${memberId}`);
    await deleteSchedule(db, accountId, scheduleId);
    const m = await db.get<{ default_schedule_id: string | null }>(
      sql`SELECT default_schedule_id FROM member WHERE id = ${memberId}`,
    );
    expect(m!.default_schedule_id).toBeNull();
    const r = await getAvailability(db, ARGS());
    expect(r!.emptyReason).toBe('NO_SCHEDULE');
  });

  it('deleteSchedule is tenant-scoped: another account id cannot trigger the re-pointing', async () => {
    await deleteSchedule(db, 'not-my-account', scheduleId);
    const et = await db.get<{ schedule_id: string | null }>(
      sql`SELECT schedule_id FROM event_type WHERE slug = 'intro-call'`,
    );
    expect(et!.schedule_id).toBe(scheduleId);
  });

  // --- Teams ------------------------------------------------------------------

  const TEAM_ARGS = () => ({ accountCode: 'acme', teamSlug: 'sales', slug: 'team-demo', ...WINDOW() });

  it('team: NO_HOSTS when the event has no hosts assigned', async () => {
    await db.run(sql`DELETE FROM event_type_host WHERE 1 = 1`);
    const r = await getTeamAvailability(db, TEAM_ARGS());
    expect(r!.slots).toEqual([]);
    expect(r!.emptyReason).toBe('NO_HOSTS');
  });

  it('team (round_robin): config reason only when EVERY host is broken', async () => {
    // Break one host only → the healthy host still yields slots, no reason.
    await db.run(sql`UPDATE member SET default_schedule_id = NULL WHERE handle = 'jordan-lee'`);
    await db.run(sql`DELETE FROM schedule WHERE member_id = (SELECT id FROM member WHERE handle = 'jordan-lee')`);
    const partial = await getTeamAvailability(db, TEAM_ARGS());
    expect(partial!.slots.length).toBeGreaterThan(0);
    expect(partial!.emptyReason).toBeUndefined();

    // Break the other host too → NO_HOURS/NO_SCHEDULE class reason surfaces.
    await db.run(sql`DELETE FROM availability WHERE schedule_id = ${scheduleId}`);
    const broken = await getTeamAvailability(db, TEAM_ARGS());
    expect(broken!.slots).toEqual([]);
    expect(broken!.emptyReason).toBe('NO_SCHEDULE');
  });

  it('team: CALENDAR_UNAVAILABLE fails closed for availability and booking', async () => {
    const jordanId = (await db.get<{ id: string }>(sql`SELECT id FROM member WHERE handle = 'jordan-lee'`))!.id;
    const healthy = await getTeamAvailability(db, TEAM_ARGS());
    const startMs = new Date(healthy!.slots[0]!).getTime();

    // Only ALEX's calendar is unreadable → he's skipped, Jordan still books.
    await connectConflictCalendar(memberId);
    const graceful = await createTeamBooking(
      db,
      {
        accountCode: 'acme',
        teamSlug: 'sales',
        slug: 'team-demo',
        startMs,
        attendee: { name: 'Sam Guest', email: 'sam@example.com', timeZone: 'America/New_York' },
      },
      new FailingCalendarProvider(),
    );
    expect(graceful.ok).toBe(true);
    if (graceful.ok) expect(graceful.hostMemberId).toBe(jordanId);

    // EVERY host unreadable → fail closed with a visible reason (both surfaces).
    await connectConflictCalendar(jordanId, 'cal-ext-2');
    const r = await getTeamAvailability(db, TEAM_ARGS(), new FailingCalendarProvider());
    expect(r!.slots).toEqual([]);
    expect(r!.emptyReason).toBe('CALENDAR_UNAVAILABLE');

    const out = await createTeamBooking(
      db,
      {
        accountCode: 'acme',
        teamSlug: 'sales',
        slug: 'team-demo',
        startMs: startMs + 3600_000,
        attendee: { name: 'Sam Guest', email: 'sam2@example.com', timeZone: 'America/New_York' },
      },
      new FailingCalendarProvider(),
    );
    expect(out).toEqual({ ok: false, reason: 'CALENDAR_UNAVAILABLE' });
  });

  // --- Persisted connection health ---------------------------------------------

  it('recordConnectionHealth round-trips through listConnections', async () => {
    await connectConflictCalendar();
    const before = await listConnections(db, memberId);
    expect(before[0]!.lastCheckAt).toBeNull();
    expect(before[0]!.lastCheckOk).toBeNull();

    await recordConnectionHealth(db, memberId, before[0]!.id, { ok: false, detail: 'Reauthorization required' });
    const after = await listConnections(db, memberId);
    expect(after[0]!.lastCheckOk).toBe(false);
    expect(after[0]!.lastCheckDetail).toBe('Reauthorization required');
    expect(after[0]!.lastCheckAt).toBeGreaterThan(0);

    // Wrong member id must not write (tenant scoping).
    await recordConnectionHealth(db, 'other-member', before[0]!.id, { ok: true });
    expect((await listConnections(db, memberId))[0]!.lastCheckOk).toBe(false);
  });
});
