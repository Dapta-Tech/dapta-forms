/**
 * `getAccountPublicCode`: the first segment of a form link the API hands out.
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
import { getAccountByCode } from './forms';
import { getAccountPublicCode, setVanitySlug } from './short-links';

let db: Db;
let accountId: string;
let accountCode: string;
let sqliteDir: string | undefined;

beforeEach(async () => {
  const databaseUrl =
    process.env.DATABASE_URL ?? `file:${join(await mkdtemp(join(tmpdir(), 'quill-public-code-')), 'forms.db')}`;
  if (!process.env.DATABASE_URL) sqliteDir = join(databaseUrl.slice('file:'.length), '..');
  db = await createDb(databaseUrl);
  await migrate(db);

  accountId = randomUUID();
  accountCode = `p${accountId.slice(0, 8)}`;
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${accountId}, ${accountCode}, ${'Public code'}, ${Date.now()})`,
  );
});

afterEach(async () => {
  if (db) {
    await db.run(sql`DELETE FROM account_alias WHERE account_id = ${accountId}`);
    await db.run(sql`DELETE FROM account WHERE id = ${accountId}`);
  }
  await db?.close();
  if (sqliteDir) await rm(sqliteDir, { recursive: true, force: true });
  sqliteDir = undefined;
});

describe('getAccountPublicCode', () => {
  it('is the short code while the workspace has no vanity slug', async () => {
    expect(await getAccountPublicCode(db, accountId)).toBe(accountCode);
  });

  it('is the vanity slug once one is claimed, and resolves back to the account', async () => {
    const vanity = `v${accountId.slice(0, 8)}`;
    expect((await setVanitySlug(db, accountId, vanity)).ok).toBe(true);

    const code = await getAccountPublicCode(db, accountId);
    expect(code).toBe(vanity);
    expect((await getAccountByCode(db, code!))?.id).toBe(accountId);
  });

  it('is null for an account that does not exist', async () => {
    expect(await getAccountPublicCode(db, randomUUID())).toBeNull();
  });
});
