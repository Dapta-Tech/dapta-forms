/**
 * Per-person playbook state (0035): the first open is kept, the last open only
 * moves forward, and people and playbooks stay apart.
 *
 * Defaults to a temp SQLite file; CI runs the identical assertions against
 * DATABASE_URL on Postgres, which is where the upsert's CASE has to mean the
 * same thing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import { PLAYBOOK_GALLERY_SLUG, listPlaybookStates, recordPlaybookSeen } from './playbooks';

const T0 = Date.parse('2026-12-01T15:00:00Z');

let db: Db;
let user: string;
let sqliteDir: string | undefined;

beforeEach(async () => {
  const databaseUrl =
    process.env.DATABASE_URL ?? `file:${join(await mkdtemp(join(tmpdir(), 'quill-playbooks-')), 'forms.db')}`;
  if (!process.env.DATABASE_URL) sqliteDir = join(databaseUrl.slice('file:'.length), '..');
  db = await createDb(databaseUrl);
  await migrate(db);
  user = `user-${randomUUID()}`;
});

afterEach(async () => {
  if (db) await db.run(sql`DELETE FROM playbook_state WHERE user_id LIKE ${`${user}%`}`);
  await db?.close();
  if (sqliteDir) await rm(sqliteDir, { recursive: true, force: true });
  sqliteDir = undefined;
});

const stateOf = async (slug: string, who = user) =>
  (await listPlaybookStates(db, who)).find((s) => s.playbookSlug === slug);

describe('recordPlaybookSeen', () => {
  it('keeps the first open and moves the last one on every later open', async () => {
    expect(await recordPlaybookSeen(db, user, 'hook-de-dolor', T0)).toEqual({
      playbookSlug: 'hook-de-dolor',
      firstSeenAt: T0,
      lastSeenAt: T0,
      first: true,
    });
    expect(await recordPlaybookSeen(db, user, 'hook-de-dolor', T0 + 5000)).toEqual({
      playbookSlug: 'hook-de-dolor',
      firstSeenAt: T0,
      lastSeenAt: T0 + 5000,
      first: false,
    });
    expect(await stateOf('hook-de-dolor')).toEqual({ playbookSlug: 'hook-de-dolor', firstSeenAt: T0, lastSeenAt: T0 + 5000 });
  });

  it('is idempotent and never moves the last open backwards', async () => {
    await recordPlaybookSeen(db, user, 'a', T0 + 1000);
    await recordPlaybookSeen(db, user, 'a', T0 + 1000);
    // A late report from another tab, stamped earlier.
    const late = await recordPlaybookSeen(db, user, 'a', T0);
    expect(late).toMatchObject({ firstSeenAt: T0 + 1000, lastSeenAt: T0 + 1000, first: false });
    expect(await listPlaybookStates(db, user)).toHaveLength(1);
  });

  it('keeps people and playbooks apart, and the gallery visit in its own row', async () => {
    await recordPlaybookSeen(db, user, 'a', T0);
    await recordPlaybookSeen(db, user, PLAYBOOK_GALLERY_SLUG, T0 + 1);
    await recordPlaybookSeen(db, `${user}-other`, 'b', T0 + 2);
    expect((await listPlaybookStates(db, user)).map((s) => s.playbookSlug).sort()).toEqual([PLAYBOOK_GALLERY_SLUG, 'a']);
    expect(await stateOf('b')).toBeUndefined();
    expect(await stateOf('b', `${user}-other`)).toMatchObject({ firstSeenAt: T0 + 2 });
  });
});
