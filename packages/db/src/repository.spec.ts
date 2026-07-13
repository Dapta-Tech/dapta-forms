import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, sql, type Db } from './client';
import { migrate } from './migrate';
import { seed } from './seed';
import { createBooking, getAvailability, getPublicProfile } from './repository';

// End-to-end against an in-memory SQLite database — no infra. Proves the
// engine→repository→booking path and the dual-enforced double-booking guard.
describe('repository (SQLite in-memory)', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
  });

  it('resolves the seeded public profile', async () => {
    const profile = await getPublicProfile(db, 'acme', 'alex-rivera');
    expect(profile).toBeDefined();
    expect(profile!.account.code).toBe('acme');
    expect(profile!.eventTypes.map((e) => e.slug)).toContain('intro-call');
  });

  it('computes real slots for the seeded event type', async () => {
    // A 10-day window starting "now" — the Mon–Fri 9–17 schedule yields slots.
    const fromMs = Date.now();
    const toMs = fromMs + 10 * 86_400_000;
    const result = await getAvailability(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      fromMs,
      toMs,
    });
    expect(result).toBeDefined();
    expect(result!.eventType.lengthMinutes).toBe(30);
    expect(result!.slots.length).toBeGreaterThan(0);
    // Slots are ISO-8601 UTC strings, ascending.
    const times = result!.slots.map((s) => new Date(s.startUtc).getTime());
    const sorted = [...times].sort((a, b) => a - b);
    expect(times).toEqual(sorted);
  });

  it('books a free slot and rejects a double-booking of the same host+slot', async () => {
    const fromMs = Date.now();
    const toMs = fromMs + 10 * 86_400_000;
    const avail = await getAvailability(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      fromMs,
      toMs,
    });
    const slot = avail!.slots[0]!.startUtc;
    const startMs = new Date(slot).getTime();

    const first = await createBooking(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      startMs,
      attendee: { name: 'Sam Guest', email: 'sam@example.com', timeZone: 'America/New_York' },
      answers: { company: 'Acme' },
    });
    expect(first.ok).toBe(true);

    const second = await createBooking(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      startMs,
      attendee: { name: 'Pat Guest', email: 'pat@example.com', timeZone: 'America/New_York' },
      answers: { company: 'Acme' },
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('SLOT_TAKEN');
  });

  it('resolves availability and booking by memberId for a member with NO handle', async () => {
    // The authenticated host surface books manual slots before a public handle
    // exists — the handle-based public lookup rightly fails, the by-id host
    // lookup must not (this silently emptied /admin/bookings/new).
    const memberId = (await db.get<{ id: string }>(sql`SELECT id FROM member WHERE handle='alex-rivera'`))!.id;
    await db.run(sql`UPDATE member SET handle=NULL WHERE id=${memberId}`);

    const fromMs = Date.now();
    const toMs = fromMs + 10 * 86_400_000;
    const byHandle = await getAvailability(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      fromMs,
      toMs,
    });
    expect(byHandle).toBeUndefined();

    const byId = await getAvailability(db, {
      accountCode: 'acme',
      memberId,
      slug: 'intro-call',
      fromMs,
      toMs,
    });
    expect(byId).toBeDefined();
    expect(byId!.slots.length).toBeGreaterThan(0);

    const booked = await createBooking(db, {
      accountCode: 'acme',
      memberId,
      slug: 'intro-call',
      startMs: new Date(byId!.slots[0]!.startUtc).getTime(),
      attendee: { name: 'Sam Guest', email: 'sam@example.com', timeZone: 'America/New_York' },
      answers: { company: 'Acme' },
    });
    expect(booked.ok).toBe(true);

    // Tenant isolation: the by-id path never crosses accounts.
    const crossAccount = await getAvailability(db, {
      accountCode: 'other-account',
      memberId,
      slug: 'intro-call',
      fromMs,
      toMs,
    });
    expect(crossAccount).toBeUndefined();
  });

  it('is idempotent on a repeated idempotency key', async () => {
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
    const args = {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      startMs,
      attendee: { name: 'Sam Guest', email: 'sam@example.com', timeZone: 'America/New_York' },
      answers: { company: 'Acme' },
      idempotencyKey: 'key-123',
    };
    const a = await createBooking(db, args);
    const b = await createBooking(db, args);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) expect(b.booking.uid).toBe(a.booking.uid);
  });
});
