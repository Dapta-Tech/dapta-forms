import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import { seed } from './seed';
import { createBooking } from './repository';
import {
  createTeamBooking,
  getTeamAvailability,
  loadBookingNotificationContext,
} from './parity';
import { createEventType, createTeam, getEventTypeById, updateEventType } from './crud';

/**
 * The three FREE team scheduling methods (the layer Calendly/Cal.com paywall):
 * round-robin (UNION + assign-one, already covered in parity.spec) plus the new
 * collective (INTERSECTION + assign-all) and fixed_round_robin.
 */
describe('team scheduling methods (SQLite in-memory)', () => {
  let db: Db;
  let accountId: string;
  let alexId: string;
  let jordanId: string;

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    accountId = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code='acme'`))!.id;
    alexId = (await db.get<{ id: string }>(sql`SELECT id FROM member WHERE handle='alex-rivera'`))!.id;
    jordanId = (await db.get<{ id: string }>(sql`SELECT id FROM member WHERE handle='jordan-lee'`))!.id;
  });

  /** Build a team + team event with the given method and hosts (member_id + isFixed). */
  async function makeTeamEvent(
    slug: string,
    schedulingType: string,
    hosts: Array<{ memberId: string; isFixed?: boolean; priority?: number }>,
  ): Promise<{ teamSlug: string; slug: string }> {
    const team = await createTeam(db, accountId, { name: slug, slug: `${slug}-team` });
    if (!team.ok) throw new Error('team create failed');
    const ev = await createEventType(db, accountId, null, {
      slug,
      title: slug,
      lengthMinutes: 30,
      schedulingType: schedulingType as 'round_robin',
      scheduleId: null,
      teamId: team.value.id,
    });
    if (!ev.ok) throw new Error('event create failed');
    const now = Date.now();
    for (const h of hosts) {
      await db.run(
        sql`INSERT INTO event_type_host (id, account_id, event_type_id, member_id, is_fixed, priority, weight, schedule_id, created_at)
            VALUES (${randomUUID()}, ${accountId}, ${ev.value.id}, ${h.memberId}, ${h.isFixed ? 1 : 0}, ${h.priority ?? null}, ${100}, ${null}, ${now})`,
      );
    }
    return { teamSlug: `${slug}-team`, slug };
  }

  const teamSlots = async (t: { teamSlug: string; slug: string }) =>
    (await getTeamAvailability(db, {
      accountCode: 'acme',
      teamSlug: t.teamSlug,
      slug: t.slug,
      fromMs: Date.now(),
      toMs: Date.now() + 10 * 86_400_000,
    }))!.slots;

  // --- Collective ---------------------------------------------------------

  it('collective availability = INTERSECTION (a slot one host is busy for is dropped)', async () => {
    const collab = await makeTeamEvent('collab', 'collective', [
      { memberId: alexId },
      { memberId: jordanId },
    ]);
    const rr = await makeTeamEvent('rr', 'round_robin', [
      { memberId: alexId },
      { memberId: jordanId },
    ]);

    const before = await teamSlots(collab);
    const slotS = new Date(before[0]!).getTime();

    // Block Alex personally at slot S.
    await createEventType(db, accountId, alexId, {
      slug: 'alex-busy',
      title: 'Busy',
      lengthMinutes: 30,
      scheduleId: null,
    });
    const busy = await createBooking(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'alex-busy',
      startMs: slotS,
      attendee: { name: 'X', email: 'x@example.com', timeZone: 'America/New_York' },
    });
    expect(busy.ok).toBe(true);

    // Collective drops S (Alex busy → not ALL free); round-robin keeps it (Jordan free).
    expect(await teamSlots(collab)).not.toContain(before[0]);
    expect(await teamSlots(rr)).toContain(before[0]);
  });

  it('collective booking assigns ALL hosts (booking_host row per host)', async () => {
    const collab = await makeTeamEvent('collab', 'collective', [
      { memberId: alexId },
      { memberId: jordanId },
    ]);
    const slotS = new Date((await teamSlots(collab))[0]!).getTime();

    const out = await createTeamBooking(db, {
      accountCode: 'acme',
      teamSlug: collab.teamSlug,
      slug: collab.slug,
      startMs: slotS,
      attendee: { name: 'Pat', email: 'pat@example.com', timeZone: 'America/New_York' },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const hostRows = await db.all<{ member_id: string }>(
      sql`SELECT bh.member_id FROM booking_host bh
          JOIN booking b ON b.id = bh.booking_id WHERE b.uid = ${out.uid}`,
    );
    expect(hostRows.map((r) => r.member_id).sort()).toEqual([alexId, jordanId].sort());
    // The organizer is one of the assigned hosts.
    expect([alexId, jordanId]).toContain(out.hostMemberId);
  });

  it('collective booking is SLOT_TAKEN when any required host is busy', async () => {
    const collab = await makeTeamEvent('collab', 'collective', [
      { memberId: alexId },
      { memberId: jordanId },
    ]);
    const slotS = new Date((await teamSlots(collab))[0]!).getTime();

    // Jordan gets booked personally at S first.
    await createEventType(db, accountId, jordanId, {
      slug: 'jordan-busy',
      title: 'Busy',
      lengthMinutes: 30,
      scheduleId: null,
    });
    await createBooking(db, {
      accountCode: 'acme',
      handle: 'jordan-lee',
      slug: 'jordan-busy',
      startMs: slotS,
      attendee: { name: 'X', email: 'x@example.com', timeZone: 'America/New_York' },
    });

    const out = await createTeamBooking(db, {
      accountCode: 'acme',
      teamSlug: collab.teamSlug,
      slug: collab.slug,
      startMs: slotS,
      attendee: { name: 'Pat', email: 'pat@example.com', timeZone: 'America/New_York' },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('SLOT_TAKEN');
  });

  it('a collective co-host (not organizer) is still busy for later bookings (booking_host feeds busy)', async () => {
    // Alex outranks Jordan → Alex is the organizer (host_member_id), so Jordan is
    // recorded ONLY in booking_host. A second team that has Jordan alone must then
    // see slot S as taken — proving loadBusyForHost reads booking_host.
    const collab = await makeTeamEvent('collab', 'collective', [
      { memberId: alexId, priority: 10 },
      { memberId: jordanId, priority: 0 },
    ]);
    const jordanOnly = await makeTeamEvent('jonly', 'round_robin', [{ memberId: jordanId }]);

    const slotS = new Date((await teamSlots(collab))[0]!).getTime();
    const first = await createTeamBooking(db, {
      accountCode: 'acme',
      teamSlug: collab.teamSlug,
      slug: collab.slug,
      startMs: slotS,
      attendee: { name: 'Pat', email: 'pat@example.com', timeZone: 'America/New_York' },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.hostMemberId).toBe(alexId); // Alex organizer → Jordan is co-host only

    expect(await teamSlots(jordanOnly)).not.toContain(new Date(slotS).toISOString());
  });

  it('collective notifies every assigned host (co-hosts on the notification context)', async () => {
    const collab = await makeTeamEvent('collab', 'collective', [
      { memberId: alexId },
      { memberId: jordanId },
    ]);
    const slotS = new Date((await teamSlots(collab))[0]!).getTime();
    const out = await createTeamBooking(db, {
      accountCode: 'acme',
      teamSlug: collab.teamSlug,
      slug: collab.slug,
      startMs: slotS,
      attendee: { name: 'Pat', email: 'pat@example.com', timeZone: 'America/New_York' },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const ctx = await loadBookingNotificationContext(db, out.uid);
    const allHostEmails = [ctx!.host.email, ...ctx!.coHosts.map((h) => h.email)].sort();
    expect(allHostEmails).toEqual(['alex@example.com', 'jordan@example.com'].sort());
  });

  // --- Fixed round-robin --------------------------------------------------

  it('fixed_round_robin: the fixed host is always assigned as organizer', async () => {
    const fx = await makeTeamEvent('fixedrr', 'fixed_round_robin', [
      { memberId: alexId, isFixed: true },
      { memberId: jordanId, isFixed: false },
    ]);
    const slotS = new Date((await teamSlots(fx))[0]!).getTime();
    const out = await createTeamBooking(db, {
      accountCode: 'acme',
      teamSlug: fx.teamSlug,
      slug: fx.slug,
      startMs: slotS,
      attendee: { name: 'Pat', email: 'pat@example.com', timeZone: 'America/New_York' },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // Alex (fixed) is the durable organizer; both hosts are assigned.
    expect(out.hostMemberId).toBe(alexId);
    const hostRows = await db.all<{ member_id: string }>(
      sql`SELECT bh.member_id FROM booking_host bh
          JOIN booking b ON b.id = bh.booking_id WHERE b.uid = ${out.uid}`,
    );
    expect(hostRows.map((r) => r.member_id).sort()).toEqual([alexId, jordanId].sort());
  });

  // --- Host detail persistence (the editor write path) --------------------

  it('createEventType persists per-host priority/weight/isFixed and reads them back', async () => {
    const team = await createTeam(db, accountId, { name: 'Detail', slug: 'detail-team' });
    if (!team.ok) throw new Error('team');
    const ev = await createEventType(db, accountId, null, {
      slug: 'detail',
      title: 'Detail',
      lengthMinutes: 30,
      schedulingType: 'fixed_round_robin',
      teamId: team.value.id,
      hosts: [
        { memberId: alexId, priority: 5, weight: 200, isFixed: true },
        { memberId: jordanId, priority: 0, weight: 100, isFixed: false },
      ],
    });
    expect(ev.ok).toBe(true);
    if (!ev.ok) return;

    const view = await getEventTypeById(db, accountId, ev.value.id);
    const alex = view!.hosts.find((h) => h.memberId === alexId)!;
    const jordan = view!.hosts.find((h) => h.memberId === jordanId)!;
    expect(alex).toMatchObject({ priority: 5, weight: 200, isFixed: true });
    expect(jordan).toMatchObject({ priority: 0, weight: 100, isFixed: false });

    // updateEventType replaces host detail (the editor saves the full set).
    const upd = await updateEventType(db, accountId, ev.value.id, {
      schedulingType: 'round_robin',
      hosts: [{ memberId: alexId, priority: 1, weight: 150, isFixed: false }],
    });
    expect(upd.ok).toBe(true);
    const after = await getEventTypeById(db, accountId, ev.value.id);
    expect(after!.schedulingType).toBe('round_robin');
    expect(after!.hosts).toHaveLength(1);
    expect(after!.hosts[0]).toMatchObject({ memberId: alexId, priority: 1, weight: 150 });
  });

  it('fixed_round_robin availability requires the fixed host to be free', async () => {
    const fx = await makeTeamEvent('fixedrr', 'fixed_round_robin', [
      { memberId: alexId, isFixed: true },
      { memberId: jordanId, isFixed: false },
    ]);
    const before = await teamSlots(fx);
    const slotS = new Date(before[0]!).getTime();

    // Block the FIXED host (Alex) at S → the slot must disappear even though the
    // rotating host (Jordan) is still free.
    await createEventType(db, accountId, alexId, {
      slug: 'alex-busy2',
      title: 'Busy',
      lengthMinutes: 30,
      scheduleId: null,
    });
    await createBooking(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'alex-busy2',
      startMs: slotS,
      attendee: { name: 'X', email: 'x@example.com', timeZone: 'America/New_York' },
    });
    expect(await teamSlots(fx)).not.toContain(before[0]);
  });
});
