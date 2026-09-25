/**
 * Submission integrity — the SQLite↔Postgres parity guarantee for Forms (the
 * dialect-parity guarantee this product pins in CI). One persisted submission per
 * (form, session): re-submitting the same session UPDATES the same row rather
 * than creating a duplicate, and the (form_id, session_id) unique index backs it
 * on both dialects. This is the test CI re-runs against Postgres for parity.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { parseSubmissionVisit } from '@quill/types';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import { upsertSubmission, listSubmissions } from './forms';
import {
  allSubmissionsForExport,
  deleteSubmissionsForAccount,
  getSubmissionAnswersForAccount,
  MAX_BULK_SUBMISSIONS,
  querySubmissions,
} from './analytics';

let db: Db;
let accountId: string;
let formId: string;

/**
 * Hold the two reads that begin concurrent finalizations until both have
 * observed the same partial row. This stays test-local: production code has no
 * testing hook or scheduling concern.
 */
function interleaveFirstTwoReads(source: Db): Db {
  let reached = 0;
  let release!: () => void;
  const bothReadsReached = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    ...source,
    get: async <T>(query: SQL): Promise<T | undefined> => {
      const row = await source.get<T>(query);
      if (reached < 2) {
        reached += 1;
        if (reached === 2) release();
        await bothReadsReached;
      }
      return row;
    },
  };
}

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

  it('reports whether the row was already completed, so effects fire exactly once', async () => {
    // The row is idempotent per session; its downstream effects (emails, CRM
    // deliveries) are not. `wasCompletedBefore` is what lets the service tell a
    // first completion from a transport-retry re-landing of the same one.
    const session = 'effects-once';
    const first = await upsertSubmission(db, { formId, sessionId: session, data: { a: 1 }, score: 3, partial: true });
    expect(first.wasCompletedBefore).toBe(false); // fresh insert

    const completed = await upsertSubmission(db, { formId, sessionId: session, data: { a: 1, b: 2 }, score: 7 });
    expect(completed.wasCompletedBefore).toBe(false); // partial→complete: FIRST completion

    const retried = await upsertSubmission(db, { formId, sessionId: session, data: { a: 1, b: 2 }, score: 7 });
    expect(retried.wasCompletedBefore).toBe(true); // re-landed complete: effects already owed

    const latePartial = await upsertSubmission(db, { formId, sessionId: session, data: { a: 1 }, score: 3, partial: true });
    expect(latePartial.wasCompletedBefore).toBe(true); // reorder-guarded no-op
  });

  it('reports exactly one first completion when finalizations race', async () => {
    const session = 'concurrent-finalization';
    await upsertSubmission(db, { formId, sessionId: session, data: { a: 1 }, score: 3, partial: true });

    const racingDb = interleaveFirstTwoReads(db);
    const results = await Promise.all([
      upsertSubmission(racingDb, { formId, sessionId: session, data: { a: 1, b: 2 }, score: 7 }),
      upsertSubmission(racingDb, { formId, sessionId: session, data: { a: 1, b: 3 }, score: 8 }),
    ]);

    expect(results.filter((row) => !row.wasCompletedBefore)).toHaveLength(1);
  });

  it('creates distinct rows for distinct sessions', async () => {
    await upsertSubmission(db, { formId, sessionId: 'a', data: {}, score: 0 });
    await upsertSubmission(db, { formId, sessionId: 'b', data: {}, score: 0 });
    expect(await listSubmissions(db, formId)).toHaveLength(2);
  });

  it('orders tied started timestamps by id descending', async () => {
    const startedAt = 1_700_000_000_000;
    for (const id of ['submission-tie-a', 'submission-tie-b', 'submission-tie-c']) {
      await db.run(
        sql`INSERT INTO submission (id, form_id, session_id, data, score, started_at)
            VALUES (${id}, ${formId}, ${'session-' + id}, ${'{}'}, ${0}, ${startedAt})`,
      );
    }

    expect((await listSubmissions(db, formId)).map((row) => row.id)).toEqual([
      'submission-tie-c',
      'submission-tie-b',
      'submission-tie-a',
    ]);
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

/**
 * The page a submission was answered on (#199). A write without a visit never
 * erases one already stored (a partial caught the landing's cookie, the
 * complete ran out of time asking), a write with one replaces it, and the
 * dashboard's read side never hands the HubSpot cookie out. Both dialects: the
 * COALESCE over a jsonb column is exactly the kind of statement that passes on
 * SQLite and fails on Postgres.
 */
describe('submission visit', () => {
  const HUTK = '0123456789abcdef0123456789abcdef';
  const LANDING = {
    pageUri: 'https://landing.example.com/offer?utm_source=fb',
    pageName: 'Home insurance',
    pageId: '12345',
    hutk: HUTK,
    hsPortalId: '4321',
    embedded: true,
  };
  const DIRECT = { pageUri: 'https://forms.example.com/acme/f/quote', pageName: 'Quote', embedded: false };

  async function visitOf(session: string) {
    const rows = await listSubmissions(db, formId);
    return rows.find((r) => r.sessionId === session)?.visit;
  }

  it('stores the visit the first write carries, and reads no visit as null', async () => {
    const stored = await upsertSubmission(db, {
      formId,
      sessionId: 'v-first',
      data: { a: 1 },
      score: 0,
      partial: true,
      visit: LANDING,
    });
    expect(stored.visit).toEqual(LANDING);
    await upsertSubmission(db, { formId, sessionId: 'v-none', data: {}, score: 0 });
    expect(await visitOf('v-none')).toBeNull();
  });

  it('keeps the visit when a later write carries none, on the partial and the complete path', async () => {
    const session = 'v-keep';
    await upsertSubmission(db, { formId, sessionId: session, data: { a: 1 }, score: 1, partial: true, visit: LANDING });
    await upsertSubmission(db, { formId, sessionId: session, data: { a: 2 }, score: 2, partial: true });
    expect(await visitOf(session)).toEqual(LANDING);

    // The completion claim is its own UPDATE: it must merge the same way, and
    // hand the MERGED row back, since that is what the deliveries are built from.
    const completed = await upsertSubmission(db, { formId, sessionId: session, data: { a: 3 }, score: 3 });
    expect(completed.wasCompletedBefore).toBe(false);
    expect(completed.completedAt).not.toBeNull();
    expect(completed.visit).toEqual(LANDING);
    expect(await visitOf(session)).toEqual(LANDING);
  });

  it('replaces the visit with a newer one', async () => {
    const session = 'v-replace';
    await upsertSubmission(db, { formId, sessionId: session, data: {}, score: 0, partial: true, visit: DIRECT });
    const completed = await upsertSubmission(db, { formId, sessionId: session, data: {}, score: 0, visit: LANDING });
    expect(completed.visit).toEqual(LANDING);
    expect(await visitOf(session)).toEqual(LANDING);
  });

  it('leaves a completed row alone when a late partial brings a visit', async () => {
    const session = 'v-late';
    await upsertSubmission(db, { formId, sessionId: session, data: { done: true }, score: 5, visit: DIRECT });
    const late = await upsertSubmission(db, {
      formId,
      sessionId: session,
      data: {},
      score: 0,
      partial: true,
      visit: LANDING,
    });
    expect(late.wasCompletedBefore).toBe(true);
    expect(await visitOf(session)).toEqual(DIRECT);
  });

  it('gives the dashboard the page and a linked flag, never the cookie', async () => {
    const session = 'v-admin';
    const row = await upsertSubmission(db, { formId, sessionId: session, data: { a: 1 }, score: 0, visit: LANDING });
    const view = { pageUri: LANDING.pageUri, pageName: LANDING.pageName, embedded: true, hubspotLinked: true };

    const page = await querySubmissions(db, formId, {});
    const listed = page.items.find((r) => r.id === row.id);
    expect(listed?.visit).toEqual(view);
    const exported = await allSubmissionsForExport(db, formId, { ids: [row.id] });
    expect(exported[0]?.visit).toEqual(view);
    const one = await getSubmissionAnswersForAccount(db, accountId, row.id);
    expect(one?.visit).toEqual(view);
    for (const read of [page.items, exported, [one]]) expect(JSON.stringify(read)).not.toContain(HUTK);
  });

  it('stores a visit parsed from hostile strings, on Postgres too', async () => {
    // All of it arrives from a page nobody here controls. What the parse keeps
    // must be JSON Postgres accepts in a jsonb column, or the whole submit fails.
    const hostile = parseSubmissionVisit({
      pageUri: 'https://landing.example.com/\ud800',
      pageName: 'Seguro \ud800 de hogar\u0000',
      pageId: '12\ud800',
      hsPortalId: '\u0000',
      hutk: `${'a'.repeat(31)}\ud800`,
      embedded: true,
    });
    const row = await upsertSubmission(db, { formId, sessionId: 'v-hostile', data: {}, score: 0, visit: hostile });
    expect(row.visit).toEqual({ pageName: 'Seguro \ufffd de hogar', embedded: true });
  });

  it('reads a row stored before the column existed as no visit, on the dashboard too', async () => {
    await upsertSubmission(db, { formId, sessionId: 'v-legacy', data: {}, score: 0 });
    const page = await querySubmissions(db, formId, {});
    expect(page.items.find((r) => r.sessionId === 'v-legacy')?.visit).toBeNull();
  });
});

/**
 * The table's bulk tools: delete a selection, export a selection. Both are
 * `IN (...)` lists of bound ids, and the delete joins the form to the account
 * the same way the single delete does, so they run here, on both dialects.
 */
describe('bulk delete and export by ids', () => {
  /** A second tenant with its own form and one submission, to aim forged ids at. */
  async function otherTenant() {
    const acc = randomUUID();
    const form = randomUUID();
    const now = Date.now();
    await db.run(
      sql`INSERT INTO account (id, code, name, created_at) VALUES (${acc}, ${'o' + acc.slice(0, 5)}, ${'Other'}, ${now})`,
    );
    await db.run(
      sql`INSERT INTO form (id, account_id, name, slug, config, created_at, updated_at)
          VALUES (${form}, ${acc}, ${'G'}, ${'g'}, ${'{"version":1,"steps":[]}'}, ${now}, ${now})`,
    );
    const sub = await upsertSubmission(db, { formId: form, sessionId: 'foreign', data: {}, score: 0 });
    return {
      accountId: acc,
      formId: form,
      submissionId: sub.id,
      cleanup: async () => {
        await db.run(sql`DELETE FROM submission WHERE form_id = ${form}`);
        await db.run(sql`DELETE FROM form WHERE id = ${form}`);
        await db.run(sql`DELETE FROM account WHERE id = ${acc}`);
      },
    };
  }

  async function seedSessions(n: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      ids.push((await upsertSubmission(db, { formId, sessionId: `bulk-${i}`, data: {}, score: 0 })).id);
    }
    return ids;
  }

  it('deletes only the named rows of the caller and reports how many', async () => {
    const [a, b, c] = await seedSessions(3);
    expect(await deleteSubmissionsForAccount(db, accountId, formId, [a!, b!, a!])).toEqual({ deleted: 2 });
    expect((await listSubmissions(db, formId)).map((r) => r.id)).toEqual([c]);
    // A repeat names rows that are gone: nothing to do, nothing thrown.
    expect(await deleteSubmissionsForAccount(db, accountId, formId, [a!, b!])).toEqual({ deleted: 0 });
  });

  it('never touches another account, even mixed into an owned selection', async () => {
    const other = await otherTenant();
    try {
      const [mine] = await seedSessions(1);
      // Forged id alongside a real one: the real one goes, the foreign one stays.
      expect(await deleteSubmissionsForAccount(db, accountId, formId, [mine!, other.submissionId])).toEqual({
        deleted: 1,
      });
      // Aimed at the other tenant's own form, from this account: still nothing.
      expect(
        await deleteSubmissionsForAccount(db, accountId, other.formId, [other.submissionId]),
      ).toEqual({ deleted: 0 });
      expect(await listSubmissions(db, other.formId)).toHaveLength(1);
    } finally {
      await other.cleanup();
    }
  });

  it('refuses more than the limit and deletes nothing', async () => {
    const [kept] = await seedSessions(1);
    const tooMany = [kept!, ...Array.from({ length: MAX_BULK_SUBMISSIONS }, () => randomUUID())];
    await expect(deleteSubmissionsForAccount(db, accountId, formId, tooMany)).rejects.toThrow(RangeError);
    expect(await listSubmissions(db, formId)).toHaveLength(1);
    // Exactly the limit is allowed.
    expect(await deleteSubmissionsForAccount(db, accountId, formId, tooMany.slice(0, MAX_BULK_SUBMISSIONS))).toEqual({
      deleted: 1,
    });
  });

  it('exports only the named rows of this form, newest first', async () => {
    const other = await otherTenant();
    try {
      const [a, , c] = await seedSessions(3);
      const rows = await allSubmissionsForExport(db, formId, { ids: [a!, c!, other.submissionId] });
      expect(rows.map((r) => r.id).sort()).toEqual([a!, c!].sort());
      expect(await allSubmissionsForExport(db, formId, { ids: [] })).toEqual([]);
    } finally {
      await other.cleanup();
    }
  });
});
