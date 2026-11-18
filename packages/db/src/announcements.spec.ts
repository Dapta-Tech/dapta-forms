/**
 * Per-person announcement state (0029): the session count, and the first close
 * and the first follow being the ones kept.
 *
 * Defaults to a temp SQLite file; CI runs the identical assertions against
 * DATABASE_URL on Postgres, which is where the upsert's CASE and COALESCE have
 * to mean the same thing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import {
  announcementUserKey,
  listAnnouncementStates,
  recordAnnouncementAction,
  recordAnnouncementSeen,
} from './announcements';

const GAP = 30 * 60 * 1000;
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

describe('recordAnnouncementSeen', () => {
  it('counts the first sighting as one session', async () => {
    await recordAnnouncementSeen(db, user, 'a', T0, GAP);
    expect(await stateOf()).toEqual({
      announcementId: 'a',
      sessionsSeen: 1,
      lastSeenAt: T0,
      dismissedAt: null,
      clickedAt: null,
    });
  });

  it('keeps sightings inside the gap in one session, and the gap slides with them', async () => {
    await recordAnnouncementSeen(db, user, 'a', T0, GAP);
    await recordAnnouncementSeen(db, user, 'a', T0 + GAP - 1, GAP);
    await recordAnnouncementSeen(db, user, 'a', T0 + 2 * GAP - 2, GAP);
    expect((await stateOf())?.sessionsSeen).toBe(1);
    expect((await stateOf())?.lastSeenAt).toBe(T0 + 2 * GAP - 2);
  });

  it('counts a new session once the gap has passed', async () => {
    await recordAnnouncementSeen(db, user, 'a', T0, GAP);
    await recordAnnouncementSeen(db, user, 'a', T0 + GAP, GAP);
    await recordAnnouncementSeen(db, user, 'a', T0 + 3 * GAP, GAP);
    expect((await stateOf())?.sessionsSeen).toBe(3);
  });

  it('keeps announcements apart', async () => {
    await recordAnnouncementSeen(db, user, 'a', T0, GAP);
    await recordAnnouncementSeen(db, user, 'b', T0, GAP);
    await recordAnnouncementSeen(db, user, 'b', T0 + GAP, GAP);
    expect((await stateOf('a'))?.sessionsSeen).toBe(1);
    expect((await stateOf('b'))?.sessionsSeen).toBe(2);
  });
});

describe('recordAnnouncementAction', () => {
  it('stores a close without a prior sighting, and keeps the first one', async () => {
    await recordAnnouncementAction(db, user, 'a', 'dismissed', T0);
    await recordAnnouncementAction(db, user, 'a', 'dismissed', T0 + 1000);
    expect(await stateOf()).toMatchObject({ sessionsSeen: 0, dismissedAt: T0, clickedAt: null });
  });

  it('keeps the session count when the card is closed or followed', async () => {
    await recordAnnouncementSeen(db, user, 'a', T0, GAP);
    await recordAnnouncementSeen(db, user, 'a', T0 + GAP, GAP);
    await recordAnnouncementAction(db, user, 'a', 'dismissed', T0 + GAP + 1);
    await recordAnnouncementAction(db, user, 'a', 'clicked', T0 + GAP + 2);
    expect(await stateOf()).toMatchObject({ sessionsSeen: 2, dismissedAt: T0 + GAP + 1, clickedAt: T0 + GAP + 2 });
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
