/**
 * The language stored against a member.
 *
 * The column is older than the setting and has one consumer that has nothing to
 * do with the admin UI: `email-effects` reads the account owner's `locale` to
 * decide whether a submission notice goes out in English or Spanish. Nothing
 * ever wrote it, so that read always found NULL. These assertions pin the two
 * halves that matter now that something does write it: what a write stores, and
 * what a read refuses to believe.
 *
 * Defaults to a temp SQLite file; CI runs the identical assertions against
 * DATABASE_URL on Postgres.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import { getMe } from './forms';
import { getMemberLocale, setMemberLocale } from './members';

let db: Db;
let accountId: string;
let memberId: string;
let otherMemberId: string;
let sqliteDir: string | undefined;

async function addMember(role: string): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO member (id, account_id, display_name, email, role, status, created_at)
        VALUES (${id}, ${accountId}, ${'Member'}, ${`${id}@example.test`}, ${role}, ${'active'}, ${Date.now()})`,
  );
  return id;
}

beforeEach(async () => {
  const databaseUrl =
    process.env.DATABASE_URL ?? `file:${join(await mkdtemp(join(tmpdir(), 'quill-member-locale-')), 'forms.db')}`;
  if (!process.env.DATABASE_URL) sqliteDir = join(databaseUrl.slice('file:'.length), '..');

  db = await createDb(databaseUrl);
  await migrate(db);

  accountId = randomUUID();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${accountId}, ${`l${accountId.slice(0, 8)}`}, ${'Locale'}, ${Date.now()})`,
  );
  memberId = await addMember('owner');
  otherMemberId = await addMember('member');
});

afterEach(async () => {
  if (db) {
    await db.run(sql`DELETE FROM member WHERE account_id = ${accountId}`);
    await db.run(sql`DELETE FROM account WHERE id = ${accountId}`);
  }
  await db?.close();
  if (sqliteDir) await rm(sqliteDir, { recursive: true, force: true });
  sqliteDir = undefined;
});

describe('setMemberLocale', () => {
  it('stores the choice and reads it back', async () => {
    await setMemberLocale(db, accountId, memberId, 'es');
    expect(await getMemberLocale(db, accountId, memberId)).toBe('es');

    await setMemberLocale(db, accountId, memberId, 'en');
    expect(await getMemberLocale(db, accountId, memberId)).toBe('en');
  });

  it('starts as null, and null is a value it can go back to', async () => {
    // Not the same as 'en'. A member who never chose falls back to their
    // browser's Accept-Language; storing 'en' for them would freeze that shut.
    expect(await getMemberLocale(db, accountId, memberId)).toBeNull();

    await setMemberLocale(db, accountId, memberId, 'es');
    await setMemberLocale(db, accountId, memberId, null);
    expect(await getMemberLocale(db, accountId, memberId)).toBeNull();
  });

  it('touches only the member it names', async () => {
    // Language is personal. Two people in one workspace read it in two
    // languages, and neither write is the other's.
    await setMemberLocale(db, accountId, memberId, 'es');

    expect(await getMemberLocale(db, accountId, otherMemberId)).toBeNull();
  });

  it('cannot reach a member through the wrong account', async () => {
    await setMemberLocale(db, randomUUID(), memberId, 'es');

    expect(await getMemberLocale(db, accountId, memberId)).toBeNull();
  });

  it('reads an unrecognised stored value as no choice at all', async () => {
    // Plain text column, older than this feature. A value from a locale we do
    // not ship must degrade to the fallback, never reach a catalog lookup that
    // has no such key.
    await db.run(sql`UPDATE member SET locale = ${'fr-CA'} WHERE id = ${memberId}`);

    expect(await getMemberLocale(db, accountId, memberId)).toBeNull();
  });
});

describe('getMe', () => {
  it('carries the stored locale, so the login callback can seed a fresh browser', async () => {
    expect((await getMe(db, accountId, memberId))?.locale).toBeNull();

    await setMemberLocale(db, accountId, memberId, 'es');
    expect((await getMe(db, accountId, memberId))?.locale).toBe('es');
  });

  it('narrows a junk value rather than passing it through to the client', async () => {
    await db.run(sql`UPDATE member SET locale = ${'klingon'} WHERE id = ${memberId}`);

    expect((await getMe(db, accountId, memberId))?.locale).toBeNull();
  });
});
