import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, migrate, seed, sql, type Db } from '@slate/db';
import type {
  BusyInterval,
  CalendarProvider,
  CalendarSummary,
  ConnectionHealth,
  CreatedEvent,
} from '@slate/calendar';
import { DisabledCalendarProvider, InMemoryCalendarProvider } from '@slate/calendar';
import { BookingNotifier, NoopEmailProvider } from '@slate/notifications';
import { loadServerEnv } from '@slate/config/env';
import { CalendarEffects } from './calendar-effects';
import { EmailEffects } from './email-effects';
import { AdminService } from './admin.service';
import { BookingService } from './booking.service';

const ENV = loadServerEnv({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);

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

// API-level contract: every configuration failure returns a machine-readable
// emptyReason (or error code) instead of a silent empty slot list / 500.
describe('error visibility — API reason codes', () => {
  let db: Db;
  let principal: { accountId: string; memberId: string; role: 'owner' };
  let scheduleId: string;

  const services = (provider: CalendarProvider = new DisabledCalendarProvider()) => {
    const calendar = new CalendarEffects(provider, db);
    const email = new EmailEffects(new BookingNotifier(new NoopEmailProvider()), db);
    return {
      admin: new AdminService(db, calendar, email),
      booking: new BookingService(db, ENV, calendar, email),
    };
  };
  const WINDOW = () => ({
    from: new Date().toISOString(),
    to: new Date(Date.now() + 10 * 86_400_000).toISOString(),
  });

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    const accountId = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code='acme'`))!.id;
    const memberId = (await db.get<{ id: string }>(sql`SELECT id FROM member WHERE handle='alex-rivera'`))!.id;
    scheduleId = (await db.get<{ schedule_id: string }>(
      sql`SELECT schedule_id FROM event_type WHERE slug='intro-call'`,
    ))!.schedule_id;
    principal = { accountId, memberId, role: 'owner' };
  });

  it('admin availability: SCHEDULE_MISSING for a dangling schedule reference', async () => {
    await db.run(sql`UPDATE event_type SET schedule_id = ${'gone-' + randomUUID()} WHERE slug='intro-call'`);
    await db.run(sql`UPDATE member SET default_schedule_id = NULL WHERE id = ${principal.memberId}`);
    const { admin } = services();
    const r = await admin.myAvailability(principal, { slug: 'intro-call', ...WINDOW() });
    expect(r!.slots).toEqual([]);
    expect(r!.emptyReason).toBe('SCHEDULE_MISSING');
  });

  it('public availability: NO_HOURS when the schedule has no rules (schema keeps the code)', async () => {
    await db.run(sql`DELETE FROM availability WHERE schedule_id = ${scheduleId}`);
    const { booking } = services();
    const r = await booking.availability({
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      ...WINDOW(),
    });
    expect(r!.slots).toEqual([]);
    expect(r!.emptyReason).toBe('NO_HOURS');
  });

  it('admin availability: NO_SCHEDULE when the member has no schedule anywhere', async () => {
    await db.run(sql`UPDATE event_type SET schedule_id = NULL WHERE slug='intro-call'`);
    await db.run(sql`UPDATE member SET default_schedule_id = NULL WHERE id = ${principal.memberId}`);
    const { admin } = services();
    const r = await admin.myAvailability(principal, { slug: 'intro-call', ...WINDOW() });
    expect(r!.emptyReason).toBe('NO_SCHEDULE');
  });

  it('handle-less host (9b33c1a regression): availability still resolves, WITH reason codes', async () => {
    await db.run(sql`UPDATE member SET handle = NULL WHERE id = ${principal.memberId}`);
    const { admin } = services();
    const ok = await admin.myAvailability(principal, { slug: 'intro-call', ...WINDOW() });
    expect(ok!.slots.length).toBeGreaterThan(0);
    expect(ok!.emptyReason).toBeUndefined();
    // And a config error on a handle-less member is still classified.
    await db.run(sql`DELETE FROM availability WHERE schedule_id = ${scheduleId}`);
    const broken = await admin.myAvailability(principal, { slug: 'intro-call', ...WINDOW() });
    expect(broken!.emptyReason).toBe('NO_HOURS');
  });

  it('availability + booking fail CLOSED on an unreadable external calendar (no 500)', async () => {
    await db.run(
      sql`INSERT INTO connected_calendar
            (id, account_id, member_id, provider, external_id, is_destination, check_conflicts, created_at)
          VALUES (${randomUUID()}, ${principal.accountId}, ${principal.memberId}, ${'google'}, ${'cal-ext-1'}, 0, 1, ${Date.now()})`,
    );
    const healthy = services(new DisabledCalendarProvider());
    const slot = (await healthy.booking.availability({
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      ...WINDOW(),
    }))!.slots[0]!.startUtc;

    const { admin, booking } = services(new FailingCalendarProvider());
    const avail = await admin.myAvailability(principal, { slug: 'intro-call', ...WINDOW() });
    expect(avail!.slots).toEqual([]);
    expect(avail!.emptyReason).toBe('CALENDAR_UNAVAILABLE');

    const out = await booking.book({
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      startUtc: slot,
      attendee: { name: 'Sam Guest', email: 'sam@example.com', timeZone: 'America/New_York' },
      answers: { company: 'Acme' },
    });
    expect(out).toMatchObject({ error: 'CALENDAR_UNAVAILABLE', status: 409 });

    const hostOut = await admin.hostCreate(
      principal,
      {
        slug: 'intro-call',
        startUtc: slot,
        attendee: { name: 'Sam Guest', email: 'sam@example.com', timeZone: 'America/New_York' },
        answers: { company: 'Acme' },
      },
      'acme',
    );
    expect(hostOut).toEqual({ ok: false, reason: 'CALENDAR_UNAVAILABLE' });
  });

  it('reschedule fails CLOSED on the external calendar: busy target → 409 SLOT_TAKEN, unreadable → 409 CALENDAR_UNAVAILABLE', async () => {
    const CAL_REF = 'cal-ext-1';
    await db.run(
      sql`INSERT INTO connected_calendar
            (id, account_id, member_id, provider, external_id, is_destination, check_conflicts, created_at)
          VALUES (${randomUUID()}, ${principal.accountId}, ${principal.memberId}, ${'google'}, ${CAL_REF}, 0, 1, ${Date.now()})`,
    );
    const healthy = services(new DisabledCalendarProvider());
    const slots = (await healthy.booking.availability({
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      ...WINDOW(),
    }))!.slots;
    const created = await healthy.booking.book({
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      startUtc: slots[0]!.startUtc,
      attendee: { name: 'Sam Guest', email: 'sam@example.com', timeZone: 'America/New_York' },
      answers: { company: 'Acme' },
    });
    expect(created).toMatchObject({ status: 'accepted' });
    const uid = (created as { uid: string }).uid;
    const targetUtc = slots[8]!.startUtc;

    // Unreadable calendar → 409 CALENDAR_UNAVAILABLE (blocked visibly, not moved blind).
    const failing = services(new FailingCalendarProvider());
    expect(await failing.booking.reschedule(uid, { newStartUtc: targetUtc, byHost: true })).toMatchObject({
      error: 'CALENDAR_UNAVAILABLE',
      status: 409,
    });

    // External busy at the target slot → 409 SLOT_TAKEN (double-booking averted).
    const busyProvider = new InMemoryCalendarProvider();
    busyProvider.seedBusy(CAL_REF, [
      {
        startUtc: targetUtc,
        endUtc: new Date(new Date(targetUtc).getTime() + 30 * 60_000).toISOString(),
      },
    ]);
    expect(await services(busyProvider).booking.reschedule(uid, { newStartUtc: targetUtc, byHost: true })).toMatchObject({
      error: 'SLOT_TAKEN',
      status: 409,
    });

    // Conflict-free readable calendar → the same move succeeds.
    const moved = await services(new InMemoryCalendarProvider()).booking.reschedule(uid, {
      newStartUtc: targetUtc,
      byHost: true,
    });
    expect(moved).toMatchObject({ uid, startUtc: targetUtc });
  });

  it('genuinely fully-booked / out-of-range stays a plain empty list (no reason)', async () => {
    const saturday = new Date('2027-03-06T10:00:00Z'); // a Saturday; rules are Mon–Fri
    const { booking } = services();
    const r = await booking.availability({
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      from: saturday.toISOString(),
      to: new Date(saturday.getTime() + 6 * 3600_000).toISOString(),
    });
    expect(r!.slots).toEqual([]);
    expect(r!.emptyReason).toBeUndefined();
  });

  it('team availability: NO_HOSTS when the team event has no hosts', async () => {
    await db.run(sql`DELETE FROM event_type_host WHERE 1 = 1`);
    const { booking } = services();
    const w = WINDOW();
    const r = await booking.teamAvailability('acme', 'sales', 'team-demo', w.from, w.to);
    expect(r!.slots).toEqual([]);
    expect(r!.emptyReason).toBe('NO_HOSTS');
  });

  it('pingConnection persists health so the Calendars page shows last-checked state', async () => {
    const connId = randomUUID();
    await db.run(
      sql`INSERT INTO connected_calendar
            (id, account_id, member_id, provider, external_id, is_destination, check_conflicts, created_at)
          VALUES (${connId}, ${principal.accountId}, ${principal.memberId}, ${'google'}, ${'cal-ext-1'}, 1, 1, ${Date.now()})`,
    );
    const { admin } = services(new FailingCalendarProvider());
    const ping = await admin.pingConnection(principal, connId);
    expect(ping).toEqual({ ok: false, enabled: true, message: 'Reauthorization required' });

    const conns = await admin.listConnections(principal);
    expect(conns[0]!.lastCheckOk).toBe(false);
    expect(conns[0]!.lastCheckDetail).toBe('Reauthorization required');
    expect(conns[0]!.lastCheckAt).toBeGreaterThan(0);
  });
});
