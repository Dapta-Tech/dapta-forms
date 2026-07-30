/**
 * Outbox claim/lease (H2) — the guard that stops multiple API replicas
 * delivering the same row twice. Runs on both dialects (CI re-runs against
 * Postgres via DATABASE_URL, exercising FOR UPDATE SKIP LOCKED).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import {
  enqueueOutbox,
  claimDueOutbox,
  markOutboxRetry,
  markOutboxDone,
  listFailedDeliveries,
} from './outbox';

let db: Db;

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
  await db.run(sql`DELETE FROM outbox`);
});

afterEach(async () => {
  await db.run(sql`DELETE FROM outbox`);
  await db.close();
});

describe('claimDueOutbox', () => {
  it('claims due rows and does not hand the same row to a second claim', async () => {
    const now = 1_000_000;
    await enqueueOutbox(db, { kind: 'email', action: 'a', now });
    await enqueueOutbox(db, { kind: 'email', action: 'b', now });

    const first = await claimDueOutbox(db, now, { workerId: 'A' });
    expect(first).toHaveLength(2);
    expect(first.every((r) => r.claimedAt === now && r.claimedBy === 'A')).toBe(true);

    // A concurrent worker draining immediately must get NOTHING — the rows are
    // claimed and the claims are not yet stale.
    const second = await claimDueOutbox(db, now + 1, { workerId: 'B' });
    expect(second).toHaveLength(0);
  });

  it('splits rows between two workers claiming with a limit (no overlap)', async () => {
    const now = 2_000_000;
    for (let i = 0; i < 4; i++) await enqueueOutbox(db, { kind: 'email', action: `x${i}`, now });

    const a = await claimDueOutbox(db, now, { workerId: 'A', limit: 2 });
    const b = await claimDueOutbox(db, now, { workerId: 'B', limit: 2 });
    const ids = new Set([...a, ...b].map((r) => r.id));
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
    expect(ids.size).toBe(4); // disjoint sets — no row claimed twice
  });

  it('reclaims a STALE claim (a crashed worker leaves rows recoverable)', async () => {
    const now = 3_000_000;
    await enqueueOutbox(db, { kind: 'email', action: 'a', now });
    const claimed = await claimDueOutbox(db, now, { workerId: 'A' });
    expect(claimed).toHaveLength(1);

    // Not yet stale → not reclaimable.
    expect(await claimDueOutbox(db, now + 1000, { workerId: 'B', staleClaimMs: 60_000 })).toHaveLength(0);
    // Past the stale threshold → reclaimable.
    const reclaimed = await claimDueOutbox(db, now + 120_000, { workerId: 'B', staleClaimMs: 60_000 });
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]!.claimedBy).toBe('B');
  });

  it('a retry clears the claim so the row is reclaimable after backoff', async () => {
    const now = 4_000_000;
    const id = await enqueueOutbox(db, { kind: 'email', action: 'a', now });
    const claimed = await claimDueOutbox(db, now, { workerId: 'A' });
    expect(claimed).toHaveLength(1);

    await markOutboxRetry(db, id, { attempts: 1, error: 'boom', now });
    // Backoff pushed next_attempt_at forward; claim was cleared. It becomes
    // claimable again once the backoff elapses.
    const afterBackoff = now + 10_000;
    const again = await claimDueOutbox(db, afterBackoff, { workerId: 'B' });
    expect(again).toHaveLength(1);
    expect(again[0]!.claimedBy).toBe('B');
    expect(again[0]!.attempts).toBe(1);
  });

  it('does not reclaim a row already marked done', async () => {
    const now = 5_000_000;
    const id = await enqueueOutbox(db, { kind: 'email', action: 'a', now });
    await claimDueOutbox(db, now, { workerId: 'A' });
    await markOutboxDone(db, id, now);
    expect(await claimDueOutbox(db, now + 1_000_000, { workerId: 'B', staleClaimMs: 0 })).toHaveLength(0);
  });
});


/**
 * The admin's failure log. Account scoping is the invariant under test: these
 * rows carry delivery reasons for one tenant and must never be readable from
 * another, which is why the filter is in SQL and not applied afterwards.
 */
describe('listFailedDeliveries', () => {
  const ACC = 'acc-1';
  const OTHER = 'acc-2';
  const FORM = 'form-1';

  async function seedRow(
    accountId: string,
    formId: string,
    status: 'failed' | 'skipped' | 'done',
    lastError: string | null,
  ) {
    const id = await enqueueOutbox(db, {
      kind: 'booking_sync',
      action: 'crm_update',
      accountId,
      payload: JSON.stringify({ formId, sessionId: 's' }),
      now: 1_000,
    });
    await db.run(
      sql`UPDATE outbox SET status = ${status}, last_error = ${lastError}, updated_at = 2000 WHERE id = ${id}`,
    );
    return id;
  }

  it('returns only this account and this form, and only what did not land', async () => {
    const wanted = await seedRow(ACC, FORM, 'failed', 'hubspot 500');
    const skipped = await seedRow(ACC, FORM, 'skipped', 'no respondent email resolvable');
    await seedRow(ACC, FORM, 'done', null); // landed — not a failure
    await seedRow(ACC, 'form-2', 'failed', 'other form');
    await seedRow(OTHER, FORM, 'failed', 'another tenant');

    const rows = await listFailedDeliveries(db, ACC, FORM);
    expect(rows.map((r) => r.id).sort()).toEqual([skipped, wanted].sort());
    expect(rows.map((r) => r.lastError).sort()).toEqual(
      ['hubspot 500', 'no respondent email resolvable'].sort(),
    );
  });

  it('caps the list and ignores rows whose payload cannot be read', async () => {
    for (let i = 0; i < 3; i++) await seedRow(ACC, FORM, 'failed', `e${i}`);
    const bad = await enqueueOutbox(db, {
      kind: 'booking_sync',
      action: 'crm_update',
      accountId: ACC,
      payload: 'not json',
      now: 1_000,
    });
    await db.run(sql`UPDATE outbox SET status = 'failed' WHERE id = ${bad}`);

    expect(await listFailedDeliveries(db, ACC, FORM)).toHaveLength(3);
    expect(await listFailedDeliveries(db, ACC, FORM, 2)).toHaveLength(2);
  });
});
