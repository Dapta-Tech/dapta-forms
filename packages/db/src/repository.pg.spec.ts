import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { isExclusionViolation } from '@slate/engine';
import { createDb, sql, type Db } from './client';
import { migrate } from './migrate';
import { seed } from './seed';
import { createBooking, getAvailability, getMember, getAccountByCode } from './repository';

// The Postgres path is the SOURCE OF TRUTH — CI runs this on a real Postgres on
// every PR. It proves BOTH the app-level guard and the DB-level EXCLUDE
// constraint reject double-bookings. Skipped locally on the SQLite dev default.
const url = process.env.DATABASE_URL ?? '';
const isPg = url.startsWith('postgres://') || url.startsWith('postgresql://');
const describePg = isPg ? describe : describe.skip;

describePg('repository (real Postgres — the tested truth)', () => {
  let db: Db;

  beforeAll(async () => {
    db = await createDb(url);
    await migrate(db);
    await seed(db);
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  it('books a free slot and rejects the double-booking (app-level + EXCLUDE)', async () => {
    const avail = await getAvailability(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      fromMs: Date.now(),
      toMs: Date.now() + 10 * 86_400_000,
    });
    const startMs = new Date(avail!.slots[0]!.startUtc).getTime();
    const args = {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      startMs,
      attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'America/New_York' },
      answers: { company: 'Acme' },
    };
    const first = await createBooking(db, args);
    expect(first.ok).toBe(true);
    const second = await createBooking(db, {
      ...args,
      attendee: { name: 'Pat', email: 'pat@example.com', timeZone: 'America/New_York' },
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('SLOT_TAKEN');
  });

  it('the booking_no_overlap EXCLUDE constraint physically blocks an overlap', async () => {
    // Bypass the app-level check entirely and insert two overlapping accepted
    // bookings for the same host directly — the DB constraint must reject the
    // second with a 23P01 exclusion_violation. This is the hard guarantee.
    const account = await getAccountByCode(db, 'acme');
    const member = await getMember(db, account!.id, 'alex-rivera');
    const start = Date.UTC(2030, 0, 1, 15, 0, 0); // far future, no clash
    const end = start + 30 * 60_000;
    const now = Date.now();

    const rawInsert = (id: string, uid: string, s: number, e: number) =>
      db.run(sql`INSERT INTO booking (id, account_id, uid, host_member_id, title, start_ms, end_ms,
        status, created_at, updated_at)
        VALUES (${id}, ${account!.id}, ${uid}, ${member!.id}, ${'Direct'}, ${s}, ${e},
        'accepted', ${now}, ${now})`);

    await rawInsert(randomUUID(), randomUUID(), start, end);

    let threw = false;
    try {
      // Overlaps [start, end) → must violate the EXCLUDE constraint.
      await rawInsert(randomUUID(), randomUUID(), start + 10 * 60_000, end + 10 * 60_000);
    } catch (err) {
      threw = true;
      expect(isExclusionViolation(err)).toBe(true);
    }
    expect(threw).toBe(true);
  });

  it('the EXCLUDE constraint also blocks two overlapping PENDING bookings (H1)', async () => {
    // 0001 widened the predicate to status IN ('accepted','pending'): a pending
    // requiresConfirmation booking holds the slot at the DB level too, so a
    // concurrent second pending for the same host/interval must be rejected.
    const account = await getAccountByCode(db, 'acme');
    const member = await getMember(db, account!.id, 'alex-rivera');
    const start = Date.UTC(2031, 5, 1, 15, 0, 0); // far future, distinct window
    const end = start + 30 * 60_000;
    const now = Date.now();

    const rawInsertPending = (id: string, uid: string, s: number, e: number) =>
      db.run(sql`INSERT INTO booking (id, account_id, uid, host_member_id, title, start_ms, end_ms,
        status, created_at, updated_at)
        VALUES (${id}, ${account!.id}, ${uid}, ${member!.id}, ${'Direct'}, ${s}, ${e},
        'pending', ${now}, ${now})`);

    await rawInsertPending(randomUUID(), randomUUID(), start, end);

    let threw = false;
    try {
      await rawInsertPending(randomUUID(), randomUUID(), start + 10 * 60_000, end + 10 * 60_000);
    } catch (err) {
      threw = true;
      expect(isExclusionViolation(err)).toBe(true);
    }
    expect(threw).toBe(true);
  });
});
