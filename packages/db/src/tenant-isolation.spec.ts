import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, sql, type Db } from './client';
import { migrate } from './migrate';
import { seed } from './seed';
import { createBooking, getAvailability } from './repository';
import { cancelBooking, confirmBooking, declineBooking, resolveBooking } from './parity';
import {
  addTeamMember,
  createEventType,
  getEventTypeById,
  listTeamMembers,
  removeTeamMember,
  setEventTypeHosts,
} from './crud';

const ATTENDEE = { name: 'Sam', email: 'sam@example.com', timeZone: 'America/New_York' };

async function firstSlotMs(db: Db, slug = 'intro-call'): Promise<number> {
  const a = await getAvailability(db, {
    accountCode: 'acme',
    handle: 'alex-rivera',
    slug,
    fromMs: Date.now(),
    toMs: Date.now() + 10 * 86_400_000,
  });
  return new Date(a!.slots[0]!.startUtc).getTime();
}

describe('C2 + M1 — tenant isolation (cross-account IDOR blocked)', () => {
  let db: Db;
  let accountA: string; // acme (the victim)
  let accountB: string; // attacker
  let memberA: string; // alex-rivera
  let memberB: string; // attacker's member

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    accountA = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code='acme'`))!.id;
    memberA = (await db.get<{ id: string }>(sql`SELECT id FROM member WHERE handle='alex-rivera'`))!.id;
    // A separate attacker account with its own member.
    accountB = randomUUID();
    memberB = randomUUID();
    const now = Date.now();
    await db.run(sql`INSERT INTO account (id, code, name, created_at) VALUES (${accountB}, 'evil', 'Evil Inc', ${now})`);
    await db.run(
      sql`INSERT INTO member (id, account_id, handle, display_name, email, time_zone, created_at)
          VALUES (${memberB}, ${accountB}, 'mallory', 'Mallory', 'm@evil.test', 'UTC', ${now})`,
    );
  });

  it('C2 — hostCancel ignores bookings outside the caller account', async () => {
    const startMs = await firstSlotMs(db);
    const created = await createBooking(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      startMs,
      attendee: ATTENDEE,
      answers: { company: 'Acme' },
    });
    if (!created.ok) throw new Error('setup');
    const uid = created.booking.uid;

    // Attacker account B cannot cancel A's booking.
    const bad = await cancelBooking(db, { uid, byHost: true, accountId: accountB });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe('NOT_FOUND');
    expect((await resolveBooking(db, uid))?.status).toBe('accepted');

    // The owning account A can.
    const ok = await cancelBooking(db, { uid, byHost: true, accountId: accountA });
    expect(ok.ok).toBe(true);
    expect((await resolveBooking(db, uid))?.status).toBe('cancelled');
  });

  it('C2 — confirm/decline of a pending booking are account-scoped', async () => {
    const et = await createEventType(db, accountA, memberA, {
      slug: 'confirm-me',
      title: 'Needs Confirmation',
      lengthMinutes: 30,
      requiresConfirmation: true,
      scheduleId: null,
    });
    expect(et.ok).toBe(true);
    const av = await getAvailability(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'confirm-me',
      fromMs: Date.now(),
      toMs: Date.now() + 10 * 86_400_000,
    });
    const created = await createBooking(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'confirm-me',
      startMs: new Date(av!.slots[0]!.startUtc).getTime(),
      attendee: ATTENDEE,
    });
    if (!created.ok) throw new Error('setup');
    const uid = created.booking.uid;
    expect(created.booking.status).toBe('pending');

    // Attacker cannot confirm or decline A's pending booking.
    expect((await confirmBooking(db, uid, accountB)).ok).toBe(false);
    expect((await declineBooking(db, uid, 'nope', accountB)).ok).toBe(false);
    expect((await resolveBooking(db, uid))?.status).toBe('pending');

    // The owner can confirm.
    expect((await confirmBooking(db, uid, accountA)).ok).toBe(true);
    expect((await resolveBooking(db, uid))?.status).toBe('accepted');
  });

  it('M1 — team membership cannot be read or written across accounts', async () => {
    const teamId = (await db.get<{ id: string }>(sql`SELECT id FROM team WHERE slug='sales'`))!.id;

    // Attacker cannot read account A's roster.
    expect((await listTeamMembers(db, accountB, teamId)).length).toBe(0);
    // The owner sees the seeded members.
    const ownerBefore = await listTeamMembers(db, accountA, teamId);
    expect(ownerBefore.length).toBeGreaterThan(0);

    // Attacker cannot add its own member to A's team (foreign team → NOT_FOUND).
    expect((await addTeamMember(db, accountB, teamId, memberB)).ok).toBe(false);
    // The owner cannot add a foreign (account B) member to its team either.
    expect((await addTeamMember(db, accountA, teamId, memberB)).ok).toBe(false);

    // Attacker's remove against A's team is a scoped no-op.
    await removeTeamMember(db, accountB, teamId, memberA);
    expect((await listTeamMembers(db, accountA, teamId)).length).toBe(ownerBefore.length);
  });

  it('M1 — setEventTypeHosts drops cross-account members', async () => {
    const et = await createEventType(db, accountA, memberA, {
      slug: 'pooled',
      title: 'Pooled',
      lengthMinutes: 30,
      scheduleId: null,
    });
    if (!et.ok) throw new Error('setup');
    // Try to add a legit member (A) and a foreign member (B).
    await setEventTypeHosts(db, accountA, et.value.id, [memberA, memberB]);
    const view = await getEventTypeById(db, accountA, et.value.id);
    expect(view!.hostMemberIds).toContain(memberA);
    expect(view!.hostMemberIds).not.toContain(memberB);
  });
});
