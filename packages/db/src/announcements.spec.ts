/**
 * Per-person announcement state (0029): the first sighting, the first close and
 * the first follow are the ones kept.
 *
 * Defaults to a temp SQLite file; CI runs the identical assertions against
 * DATABASE_URL on Postgres, which is where the upsert's COALESCE has to mean
 * the same thing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import { announcementUserKey, listAnnouncementStates, recordAnnouncementEvent } from './announcements';

const T0 = Date.parse('2026-11-20T15:00:00Z');

let db: Db;
let user: string;
let accountId: string;
let sqliteDir: string | undefined;

beforeEach(async () => {
  const databaseUrl =
    process.env.DATABASE_URL ?? `file:${join(await mkdtemp(join(tmpdir(), 'quill-announcements-')), 'forms.db')}`;
  if (!process.env.DATABASE_URL) sqliteDir = join(databaseUrl.slice('file:'.length), '..');
  db = await createDb(databaseUrl);
  await migrate(db);
  user = `user-${randomUUID()}`;
  accountId = randomUUID();
});

afterEach(async () => {
  if (db) {
    await db.run(sql`DELETE FROM announcement_state WHERE user_id = ${user}`);
    await db.run(sql`DELETE FROM member WHERE account_id = ${accountId}`);
  }
  await db?.close();
  if (sqliteDir) await rm(sqliteDir, { recursive: true, force: true });
  sqliteDir = undefined;
});

const stateOf = async (id = 'a') => (await listAnnouncementStates(db, user)).find((s) => s.announcementId === id);

describe('recordAnnouncementEvent', () => {
  it('stores each moment once, keeping the first', async () => {
    await recordAnnouncementEvent(db, user, 'a', 'seen', T0);
    await recordAnnouncementEvent(db, user, 'a', 'seen', T0 + 1000);
    expect(await stateOf()).toEqual({ announcementId: 'a', seenAt: T0, dismissedAt: null, clickedAt: null });

    await recordAnnouncementEvent(db, user, 'a', 'dismissed', T0 + 2000);
    await recordAnnouncementEvent(db, user, 'a', 'dismissed', T0 + 3000);
    await recordAnnouncementEvent(db, user, 'a', 'clicked', T0 + 4000);
    expect(await stateOf()).toEqual({ announcementId: 'a', seenAt: T0, dismissedAt: T0 + 2000, clickedAt: T0 + 4000 });
  });

  it('stores a close without a prior sighting', async () => {
    await recordAnnouncementEvent(db, user, 'a', 'dismissed', T0);
    expect(await stateOf()).toEqual({ announcementId: 'a', seenAt: null, dismissedAt: T0, clickedAt: null });
  });

  it('keeps announcements and people apart', async () => {
    await recordAnnouncementEvent(db, user, 'a', 'dismissed', T0);
    await recordAnnouncementEvent(db, user, 'b', 'seen', T0);
    await recordAnnouncementEvent(db, `${user}-other`, 'a', 'clicked', T0);
    expect((await stateOf('a'))?.dismissedAt).toBe(T0);
    expect((await stateOf('a'))?.clickedAt).toBeNull();
    expect((await stateOf('b'))?.dismissedAt).toBeNull();
    await db.run(sql`DELETE FROM announcement_state WHERE user_id = ${`${user}-other`}`);
  });
});

describe('announcementUserKey', () => {
  async function addMember(externalId: string | null): Promise<string> {
    const id = randomUUID();
    await db.run(
      sql`INSERT INTO member (id, account_id, external_id, display_name, email, role, status, created_at)
          VALUES (${id}, ${accountId}, ${externalId}, ${'M'}, ${`${id}@example.test`}, ${'member'}, ${'active'}, ${T0})`,
    );
    return id;
  }

  it('is the identity service user id when the member carries one', async () => {
    const memberId = await addMember('iam-user-1');
    expect(await announcementUserKey(db, accountId, memberId)).toBe('iam-user-1');
  });

  it('falls back to the member row, never to an empty key', async () => {
    const memberId = await addMember(null);
    expect(await announcementUserKey(db, accountId, memberId)).toBe(`member:${memberId}`);
  });
});
