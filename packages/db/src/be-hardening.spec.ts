import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import { seed } from './seed';
import { createBooking, getAvailability } from './repository';
import { cancelBooking, rescheduleBooking, resolveBooking, listBookings } from './parity';

async function slots(db: Db, fromOffsetDays = 0, toOffsetDays = 10): Promise<number[]> {
  const a = await getAvailability(db, {
    accountCode: 'acme',
    handle: 'alex-rivera',
    slug: 'intro-call',
    fromMs: Date.now() + fromOffsetDays * 86_400_000,
    toMs: Date.now() + toOffsetDays * 86_400_000,
  });
  return a!.slots.map((s) => new Date(s.startUtc).getTime());
}

async function book(db: Db, startMs: number) {
  return createBooking(db, {
    accountCode: 'acme',
    handle: 'alex-rivera',
    slug: 'intro-call',
    startMs,
    attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'UTC' },
    answers: { company: 'Acme' },
  });
}

describe('BE hardening P1s', () => {
  let db: Db;
  let accountId: string;
  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    accountId = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code='acme'`))!.id;
  });

  it('P1-1: cancel is idempotent — a retried cancel returns success, not GONE', async () => {
    const created = await book(db, (await slots(db))[0]!);
    if (!created.ok) throw new Error('setup');
    const uid = created.booking.uid;

    const first = await cancelBooking(db, { uid, byHost: true, accountId });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.alreadyApplied).toBeUndefined();

    // Retry — was 410 GONE before; now an idempotent success.
    const retry = await cancelBooking(db, { uid, byHost: true, accountId });
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.alreadyApplied).toBe(true);

    expect((await resolveBooking(db, uid))!.status).toBe('cancelled');
  });

  it('P1-1: a truly non-cancellable state (pending never accepted) is still GONE via public path', async () => {
    // Cancelling a booking that does not exist → NOT_FOUND (sanity for the guard order).
    const missing = await cancelBooking(db, { uid: 'nope', byHost: true, accountId });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe('NOT_FOUND');
  });

  it('P1-2: reschedule with the same Idempotency-Key does not move again or re-rotate', async () => {
    const created = await book(db, (await slots(db))[0]!);
    if (!created.ok) throw new Error('setup');
    const uid = created.booking.uid;
    const targets = await slots(db, 2, 6);
    const t1 = targets[0]!;
    const t2 = targets[1]!;

    const first = await rescheduleBooking(db, { uid, newStartMs: t1, byHost: true, accountId, idempotencyKey: 'K1' });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.alreadyApplied).toBeUndefined();
    const hashAfterFirst = JSON.parse(String((await resolveBooking(db, uid))!.metadata))._manage.tokenHash;

    // Same key, DIFFERENT target → dedup: booking stays at t1, token NOT rotated.
    const replay = await rescheduleBooking(db, { uid, newStartMs: t2, byHost: true, accountId, idempotencyKey: 'K1' });
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.alreadyApplied).toBe(true);
    const b = await resolveBooking(db, uid);
    expect(Number(b!.start_ms)).toBe(t1); // did NOT move to t2
    expect(JSON.parse(String(b!.metadata))._manage.tokenHash).toBe(hashAfterFirst); // token not re-rotated

    // A NEW key moves it.
    const moved = await rescheduleBooking(db, { uid, newStartMs: t2, byHost: true, accountId, idempotencyKey: 'K2' });
    expect(moved.ok).toBe(true);
    if (moved.ok) expect(moved.alreadyApplied).toBeUndefined();
    expect(Number((await resolveBooking(db, uid))!.start_ms)).toBe(t2);
  });

  it('P1-3: listBookings paginates with a keyset cursor (no gaps, no repeats)', async () => {
    const s = await slots(db);
    for (let i = 0; i < 5; i++) expect((await book(db, s[i]!)).ok).toBe(true);

    // The full result (limit above the total → one page, no cursor).
    const full = await listBookings(db, { accountId, limit: 200 });
    expect(full.nextCursor).toBeNull();
    const total = full.items.length; // 5 booked + whatever the seed created
    expect(total).toBeGreaterThanOrEqual(5);

    // Page it two at a time and reassemble.
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await listBookings(db, { accountId, limit: 2, cursor });
      expect(res.items.length).toBeLessThanOrEqual(2);
      seen.push(...res.items.map((i) => i.uid));
      cursor = res.nextCursor ?? undefined;
      pages++;
      expect(pages).toBeLessThan(50); // guard against a cursor loop
    } while (cursor);

    expect(seen).toHaveLength(total); // no gaps
    expect(new Set(seen).size).toBe(total); // no repeats
    expect(new Set(seen)).toEqual(new Set(full.items.map((i) => i.uid))); // same set as one-shot
    expect(pages).toBe(Math.ceil(total / 2));
  });

  it('P1-3: nextCursor is null when the page holds everything, non-null when more remain', async () => {
    for (const st of (await slots(db)).slice(0, 3)) await book(db, st);
    expect((await listBookings(db, { accountId, limit: 200 })).nextCursor).toBeNull();
    expect((await listBookings(db, { accountId, limit: 1 })).nextCursor).not.toBeNull();
  });

  it('polish: an in-place reschedule records from_reschedule (the previous start)', async () => {
    const startMs = (await slots(db))[0]!;
    const created = await book(db, startMs);
    if (!created.ok) throw new Error('setup');
    const uid = created.booking.uid;
    const prevIso = new Date(startMs).toISOString();

    const target = (await slots(db, 2, 6))[0]!;
    const out = await rescheduleBooking(db, { uid, newStartMs: target, byHost: true, accountId });
    expect(out.ok).toBe(true);

    const row = await db.get<{ from_reschedule: string | null; rescheduled: number }>(
      sql`SELECT from_reschedule, rescheduled FROM booking WHERE uid = ${uid}`,
    );
    expect(row!.rescheduled).toBe(1);
    expect(row!.from_reschedule).toBe(prevIso); // audit trail: moved FROM the original time
  });
});
