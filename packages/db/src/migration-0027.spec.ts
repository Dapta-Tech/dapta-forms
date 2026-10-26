/**
 * Migration 0027 moves the single workspace link page (`account.link_page`,
 * 0025) into the new `link_page` table, so a workspace can keep several. The
 * test that matters is the upgrade path: a database at 0026 holding pages
 * takes 0027 and every existing page becomes its workspace's DEFAULT page,
 * slug `main`, with the exact same blob, so `/{accountCode}` keeps serving the
 * same content. A workspace with no page gets no row, and `account.link_page`
 * is left untouched as the fallback.
 *
 * In-memory SQLite locally. In Postgres parity mode (DATABASE_URL) the staged
 * upgrade runs in a scratch database created and dropped here, the same way
 * migration-0024.spec does it.
 */
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, sql, type Db, type Dialect } from './client';
import { migrate } from './migrate';
import { parseJsonColumn } from './forms';

const FILE = '0027_link_pages.sql';
const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = join(HERE, '..', 'migrations');
const DATABASE_URL = process.env.DATABASE_URL;
const DIALECT: Dialect = DATABASE_URL?.startsWith('postgres') ? 'postgres' : 'sqlite';

let tempRoot: string;
let scratch: { name: string; url: string; adminUrl: string } | undefined;
let db: Db;

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

/**
 * A migrations root holding the shipped scripts up to `last`, so the upgrade is
 * staged at exactly 0023 then 0024 no matter how many migrations come later.
 */
function rootThrough(last: string, inclusive: boolean): string {
  const root = join(tempRoot, randomUUID());
  const directory = join(root, DIALECT);
  mkdirSync(directory, { recursive: true });
  for (const file of readdirSync(join(MIGRATIONS_ROOT, DIALECT))) {
    if (file.endsWith('.sql') && (inclusive ? file <= last : file < last)) {
      copyFileSync(join(MIGRATIONS_ROOT, DIALECT, file), join(directory, file));
    }
  }
  return root;
}

beforeAll(async () => {
  tempRoot = mkdtempSync(join(tmpdir(), 'migration-0027-'));
  if (DIALECT !== 'postgres') return;
  const base = new URL(DATABASE_URL!);
  const admin = new URL(base);
  admin.pathname = '/postgres';
  const name = `migration_0027_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const client = postgres(admin.toString(), { max: 1 });
  try {
    await client.unsafe(`CREATE DATABASE ${quote(name)}`);
  } finally {
    await client.end({ timeout: 5 });
  }
  base.pathname = `/${name}`;
  scratch = { name, url: base.toString(), adminUrl: admin.toString() };
});

afterAll(async () => {
  try {
    if (scratch) {
      const admin = postgres(scratch.adminUrl, { max: 1 });
      try {
        await admin.unsafe(`DROP DATABASE IF EXISTS ${quote(scratch.name)}`);
      } finally {
        await admin.end({ timeout: 5 });
      }
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

beforeEach(async () => {
  if (DIALECT === 'sqlite') {
    db = await createDb('file::memory:');
  } else {
    db = await createDb(scratch!.url);
    await db.execRaw(`DROP SCHEMA public CASCADE; CREATE SCHEMA public`);
  }
});

afterEach(async () => {
  await db.close();
});


const PAGE = {
  version: 1,
  enabled: true,
  name: 'Acme',
  bio: 'Talk to us',
  items: [{ type: 'link', label: 'Site', url: 'https://acme.example' }],
  socials: { whatsapp: '573001234567' },
};
const OFF = { version: 1, enabled: false };

async function insertAccount(id: string, code: string, page: unknown): Promise<void> {
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at, link_page)
        VALUES (${id}, ${code}, ${'Acme'}, ${1_700_000_000_000}, ${page == null ? null : JSON.stringify(page)})`,
  );
}

describe(FILE, () => {
  it('copies every existing page into link_page as the default `main` page, blob unchanged', async () => {
    await migrate(db, rootThrough(FILE, false));
    const live = randomUUID();
    const off = randomUUID();
    const none = randomUUID();
    await insertAccount(live, 'acmelive', PAGE);
    await insertAccount(off, 'acmeoff', OFF);
    await insertAccount(none, 'acmenone', null);

    expect(await migrate(db, rootThrough(FILE, true))).toEqual([FILE]);

    const rows = await db.all<Record<string, unknown>>(
      sql`SELECT id, account_id, slug, name, config, is_default FROM link_page ORDER BY account_id`,
    );
    const byAccount = new Map(rows.map((r) => [String(r.account_id), r]));
    expect(rows).toHaveLength(2);
    for (const [account, blob] of [
      [live, PAGE],
      [off, OFF],
    ] as const) {
      const row = byAccount.get(account)!;
      expect(row.id).toBe(`lp-${account}`);
      expect(row.slug).toBe('main');
      expect(row.name).toBe('');
      expect(Number(row.is_default)).toBe(1);
      expect(parseJsonColumn(row.config, null)).toEqual(blob);
    }
    expect(byAccount.has(none)).toBe(false);

    // The old column is left as it was: the fallback for one release.
    const legacy = await db.get<{ link_page: unknown }>(sql`SELECT link_page FROM account WHERE id = ${live}`);
    expect(parseJsonColumn(legacy!.link_page, null)).toEqual(PAGE);
  });

  it('refuses a second default page for one workspace, and a slug twice in one workspace', async () => {
    await migrate(db, rootThrough(FILE, true));
    const account = randomUUID();
    await insertAccount(account, 'acmeidx', null);
    const insert = async (id: string, slug: string, isDefault: number) =>
      db.run(
        sql`INSERT INTO link_page (id, account_id, slug, name, config, is_default, created_at, updated_at)
            VALUES (${id}, ${account}, ${slug}, '', ${'{}'}, ${isDefault}, 1, 1)`,
      );
    await insert('a', 'main', 1);
    await insert('b', 'expo', 0);
    await expect(insert('c', 'other', 1)).rejects.toThrow();
    await expect(insert('d', 'expo', 0)).rejects.toThrow();
    // Another workspace may use the same slug and have its own default.
    const other = randomUUID();
    await insertAccount(other, 'acmeidx2', null);
    await db.run(
      sql`INSERT INTO link_page (id, account_id, slug, name, config, is_default, created_at, updated_at)
          VALUES ('e', ${other}, 'expo', '', ${'{}'}, 1, 1, 1)`,
    );
    expect(Number((await db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM link_page`))!.n)).toBe(3);
  });
});
