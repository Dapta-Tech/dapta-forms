/**
 * Migration 0024 is the schema the public API v1 builds on: who created an API
 * key (`api_key.member_id`), how a form was born (`form.created_via`), and the
 * published config a revert goes back to (`form.previous_config`,
 * `form.previous_published_at_ms`). It is purely additive, so the test that
 * matters is the upgrade path: a database migrated up to 0023 and holding rows
 * takes 0024 without losing or changing any of them, and every new column reads
 * NULL on the rows that were already there.
 *
 * In-memory SQLite locally. In Postgres parity mode (DATABASE_URL) the shared
 * database is already fully migrated, so the staged upgrade runs in a scratch
 * database created and dropped here, the same way migrate.spec does it.
 */
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, sql, type Db, type Dialect } from './client';
import { migrate } from './migrate';
import { parseJsonColumn } from './forms';
import { sqliteSchema } from './schema.sqlite';
import { pgSchema } from './schema.pg';

const FILE = '0024_api_v1.sql';
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
  tempRoot = mkdtempSync(join(tmpdir(), 'migration-0024-'));
  if (DIALECT !== 'postgres') return;
  const base = new URL(DATABASE_URL!);
  const admin = new URL(base);
  admin.pathname = '/postgres';
  const name = `migration_0024_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
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

const CONFIG = { version: 1, title: 'Live', steps: [{ id: 's1', question: 'Name?' }] };
const DRAFT = { version: 1, title: 'Draft', steps: [{ id: 's1', question: 'Your name?' }] };

/** Rows shaped like production data, written with the pre-0024 schema. */
async function seedPre0024(): Promise<{
  accountId: string;
  memberId: string;
  formIds: string[];
  keyId: string;
}> {
  const accountId = randomUUID();
  const memberId = randomUUID();
  const keyId = randomUUID();
  const formIds = [randomUUID(), randomUUID()];
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${accountId}, ${'acme0024'}, ${'Acme'}, ${1_700_000_000_000})`,
  );
  await db.run(
    sql`INSERT INTO member (id, account_id, email, role, status, created_at)
        VALUES (${memberId}, ${accountId}, ${'owner@example.com'}, ${'owner'}, ${'active'}, ${1_700_000_000_000})`,
  );
  // One published form with a pending draft, one never published.
  await db.run(
    sql`INSERT INTO form (id, account_id, name, slug, config, draft_config, published_at, created_by, created_at, updated_at)
        VALUES (${formIds[0]}, ${accountId}, ${'Published'}, ${'published'}, ${JSON.stringify(CONFIG)},
          ${JSON.stringify(DRAFT)}, ${1_700_000_100_000}, ${memberId}, ${1_700_000_000_000}, ${1_700_000_200_000})`,
  );
  await db.run(
    sql`INSERT INTO form (id, account_id, name, slug, config, created_at, updated_at)
        VALUES (${formIds[1]}, ${accountId}, ${'Legacy'}, ${'legacy'}, ${JSON.stringify(CONFIG)},
          ${1_600_000_000_000}, ${1_600_000_000_000})`,
  );
  await db.run(
    sql`INSERT INTO api_key (id, account_id, name, prefix, last4, key_hash, created_at)
        VALUES (${keyId}, ${accountId}, ${'Old key'}, ${'dforms_abcde'}, ${'wxyz'}, ${'f'.repeat(64)}, ${1_700_000_000_000})`,
  );
  return { accountId, memberId, formIds, keyId };
}

async function count(table: string): Promise<number> {
  const row = await db.get<{ n: number | string }>(sql.raw(`SELECT COUNT(*) AS n FROM ${table}`));
  return Number(row?.n);
}

async function indexNames(): Promise<string[]> {
  const rows =
    db.dialect === 'sqlite'
      ? await db.all<{ name: string }>(
          sql.raw(`SELECT name FROM sqlite_master WHERE type = 'index'`),
        )
      : await db.all<{ name: string }>(
          sql.raw(`SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public'`),
        );
  return rows.map((row) => row.name);
}

describe(FILE, () => {
  it('upgrades a database with data: no row lost or changed, and the new columns read NULL', async () => {
    await migrate(db, rootThrough(FILE, false));
    const seeded = await seedPre0024();
    const before = {
      account: await count('account'),
      member: await count('member'),
      form: await count('form'),
      apiKey: await count('api_key'),
    };

    expect(await migrate(db, rootThrough(FILE, true))).toEqual([FILE]);

    expect({
      account: await count('account'),
      member: await count('member'),
      form: await count('form'),
      apiKey: await count('api_key'),
    }).toEqual(before);

    const forms = await db.all<{
      id: string;
      config: unknown;
      draft_config: unknown;
      published_at: number | string | null;
      created_by: string | null;
      created_via: string | null;
      previous_config: unknown;
      previous_published_at_ms: number | string | null;
    }>(
      sql`SELECT id, config, draft_config, published_at, created_by, created_via, previous_config, previous_published_at_ms
          FROM form ORDER BY created_at`,
    );
    expect(forms.map((f) => f.id)).toEqual([seeded.formIds[1], seeded.formIds[0]]);
    const [legacy, published] = forms;
    expect(parseJsonColumn(published!.config, null)).toEqual(CONFIG);
    expect(parseJsonColumn(published!.draft_config, null)).toEqual(DRAFT);
    expect(Number(published!.published_at)).toBe(1_700_000_100_000);
    expect(published!.created_by).toBe(seeded.memberId);
    expect(parseJsonColumn(legacy!.config, null)).toEqual(CONFIG);
    for (const form of forms) {
      expect(form.created_via).toBeNull();
      expect(form.previous_config).toBeNull();
      expect(form.previous_published_at_ms).toBeNull();
    }

    const key = await db.get<{
      id: string;
      account_id: string;
      key_hash: string;
      member_id: string | null;
    }>(sql`SELECT id, account_id, key_hash, member_id FROM api_key WHERE id = ${seeded.keyId}`);
    expect(key).toEqual({
      id: seeded.keyId,
      account_id: seeded.accountId,
      key_hash: 'f'.repeat(64),
      member_id: null,
    });
  });

  it('indexes api_key by (account_id, member_id)', async () => {
    await migrate(db);
    expect(await indexNames()).toContain('api_key_account_member_idx');
  });

  it('is applied once: a second run is a no-op', async () => {
    await migrate(db);
    expect(await migrate(db)).toEqual([]);
  });

  it('round-trips the new columns through the Drizzle schema of the active dialect', async () => {
    await migrate(db);
    const { accountId, memberId, formIds, keyId } = await seedPre0024();
    const previous = { version: 1, title: 'Before', steps: [] };

    if (db.dialect === 'sqlite') {
      const orm = db.sqlite!.drizzle;
      const { form, apiKey } = sqliteSchema;
      await orm
        .update(form)
        .set({
          createdVia: 'api',
          previousConfig: JSON.stringify(previous),
          previousPublishedAtMs: 1_690_000_000_000,
        })
        .where(eq(form.id, formIds[0]!));
      await orm.update(apiKey).set({ memberId }).where(eq(apiKey.id, keyId));
      const [row] = await orm
        .select({
          createdVia: form.createdVia,
          previousConfig: form.previousConfig,
          previousPublishedAtMs: form.previousPublishedAtMs,
        })
        .from(form)
        .where(eq(form.id, formIds[0]!));
      expect(row).toEqual({
        createdVia: 'api',
        previousConfig: JSON.stringify(previous),
        previousPublishedAtMs: 1_690_000_000_000,
      });
      const [key] = await orm
        .select({ memberId: apiKey.memberId, accountId: apiKey.accountId })
        .from(apiKey);
      expect(key).toEqual({ memberId, accountId });
      return;
    }

    const orm = db.pg!.drizzle;
    const { form, apiKey } = pgSchema;
    await orm
      .update(form)
      .set({
        createdVia: 'api',
        previousConfig: previous,
        previousPublishedAtMs: 1_690_000_000_000,
      })
      .where(eq(form.id, formIds[0]!));
    await orm.update(apiKey).set({ memberId }).where(eq(apiKey.id, keyId));
    const [row] = await orm
      .select({
        createdVia: form.createdVia,
        previousConfig: form.previousConfig,
        previousPublishedAtMs: form.previousPublishedAtMs,
      })
      .from(form)
      .where(eq(form.id, formIds[0]!));
    expect(row).toEqual({
      createdVia: 'api',
      previousConfig: previous,
      previousPublishedAtMs: 1_690_000_000_000,
    });
    const [key] = await orm
      .select({ memberId: apiKey.memberId, accountId: apiKey.accountId })
      .from(apiKey);
    expect(key).toEqual({ memberId, accountId });
  });
});
