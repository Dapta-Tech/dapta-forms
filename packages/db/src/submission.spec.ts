/**
 * Submission integrity — the SQLite↔Postgres parity guarantee for Forms (the
 * dialect-parity guarantee this product pins in CI). One persisted submission per
 * (form, session): re-submitting the same session UPDATES the same row rather
 * than creating a duplicate, and the (form_id, session_id) unique index backs it
 * on both dialects. This is the test CI re-runs against Postgres for parity.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import { upsertSubmission, listSubmissions } from './forms';

let db: Db;
let accountId: string;
let formId: string;

beforeEach(async () => {
  // Honors DATABASE_URL so CI re-runs this same suite against real Postgres
  // (the parity job); locally it defaults to in-memory SQLite.
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
  accountId = randomUUID();
  formId = randomUUID();
  const now = Date.now();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at) VALUES (${accountId}, ${'t' + accountId.slice(0, 5)}, ${'Test'}, ${now})`,
  );
  await db.run(
    sql`INSERT INTO form (id, account_id, name, slug, config, created_at, updated_at)
        VALUES (${formId}, ${accountId}, ${'F'}, ${'f'}, ${'{"version":1,"steps":[]}'}, ${now}, ${now})`,
  );
});

afterEach(async () => {
  // Leave a shared Postgres database clean (memory SQLite just evaporates).
  await db.run(sql`DELETE FROM submission WHERE form_id = ${formId}`);
  await db.run(sql`DELETE FROM form WHERE id = ${formId}`);
  await db.run(sql`DELETE FROM account WHERE id = ${accountId}`);
  await db.close();
});

describe('submission upsert', () => {
  it('keeps ONE row per (form, session) across re-submits', async () => {
    const session = 'sess-1';
    await upsertSubmission(db, { formId, sessionId: session, data: { a: 1 }, score: 3, partial: true });
    await upsertSubmission(db, { formId, sessionId: session, data: { a: 1, b: 2 }, score: 7 });

    const rows = await listSubmissions(db, formId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBe(7);
    expect(rows[0]!.completedAt).not.toBeNull(); // final submit stamped it
    expect(rows[0]!.partialAt).not.toBeNull(); // earlier partial preserved
  });

  it('ignores a late partial that arrives AFTER the complete submit', async () => {
    // Reorder race: the fire-and-forget partial lands after the final submit.
    // A completed row must NOT be overwritten by a partial payload.
    const session = 'reorder';
    await upsertSubmission(db, {
      formId,
      sessionId: session,
      data: { a: 1, b: 2, done: true },
      score: 9,
    });
    // Late partial with stale/lesser data + score — must be a no-op on data/score.
    await upsertSubmission(db, {
      formId,
      sessionId: session,
      data: { a: 1 },
      score: 3,
      partial: true,
    });

    const rows = await listSubmissions(db, formId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBe(9); // completed score preserved
    expect(rows[0]!.data).toEqual({ a: 1, b: 2, done: true }); // completed data intact
    expect(rows[0]!.completedAt).not.toBeNull();
  });

  it('creates distinct rows for distinct sessions', async () => {
    await upsertSubmission(db, { formId, sessionId: 'a', data: {}, score: 0 });
    await upsertSubmission(db, { formId, sessionId: 'b', data: {}, score: 0 });
    expect(await listSubmissions(db, formId)).toHaveLength(2);
  });

  it('enforces the (form_id, session_id) unique index', async () => {
    await upsertSubmission(db, { formId, sessionId: 'dup', data: {}, score: 0 });
    // A raw duplicate insert must violate the unique index (the parity guarantee).
    let threw = false;
    try {
      await db.run(
        sql`INSERT INTO submission (id, form_id, session_id, data, score, started_at)
            VALUES (${randomUUID()}, ${formId}, ${'dup'}, ${'{}'}, 0, ${Date.now()})`,
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
