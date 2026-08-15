import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, sql, type Db } from './client';
import { migrate } from './migrate';

const TEST_ARTIFACT_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '.data',
  `migration-atomicity-${process.pid}-${randomUUID()}`,
);

interface MigrationFixture {
  root: string;
  filename: string;
  tableName: string;
  gateTableName: string;
  path: string;
}

function createFixture(dialect: Db['dialect']): MigrationFixture {
  const id = randomUUID().replaceAll('-', '');
  const root = join(TEST_ARTIFACT_ROOT, id);
  const directory = join(root, dialect);
  const filename = `${id}.sql`;
  const path = join(directory, filename);

  mkdirSync(directory, { recursive: true });

  return {
    root,
    filename,
    tableName: `migration_atomicity_${id}`,
    gateTableName: `migration_atomicity_gate_${id}`,
    path,
  };
}

function writeMigration(fixture: MigrationFixture, script: string): void {
  writeFileSync(fixture.path, script);
}

async function openDatabase(databaseUrl?: string): Promise<{ db: Db; databaseUrl: string }> {
  const resolvedUrl =
    databaseUrl ??
    process.env.DATABASE_URL ??
    `file:${join(TEST_ARTIFACT_ROOT, `${randomUUID()}.db`)}`;
  const db = await createDb(resolvedUrl);
  await migrate(db);
  return { db, databaseUrl: resolvedUrl };
}

async function hasMigration(db: Db, filename: string): Promise<boolean> {
  return Boolean(
    await db.get<{ name: string }>(sql`SELECT name FROM _migrations WHERE name = ${filename} LIMIT 1`),
  );
}

async function hasTable(db: Db, tableName: string): Promise<boolean> {
  if (db.dialect === 'sqlite') {
    return Boolean(
      await db.get<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${tableName} LIMIT 1`,
      ),
    );
  }

  return Boolean(
    await db.get<{ table_name: string }>(
      sql`SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ${tableName}
          LIMIT 1`,
    ),
  );
}

async function cleanFixture(db: Db, fixture: MigrationFixture): Promise<void> {
  await db.execRaw(`DROP TABLE IF EXISTS ${fixture.tableName}`);
  await db.execRaw(`DROP TABLE IF EXISTS ${fixture.gateTableName}`);
  await db.run(sql`DELETE FROM _migrations WHERE name = ${fixture.filename}`);
}

afterAll(() => {
  rmSync(TEST_ARTIFACT_ROOT, { recursive: true, force: true });
});

describe('migrate atomicity', () => {
  it('rolls back a failed migration, leaves its marker absent, and retries it', async () => {
    const { db } = await openDatabase();
    const fixture = createFixture(db.dialect);
    await db.execRaw(
      `CREATE TABLE ${fixture.gateTableName} (id INTEGER PRIMARY KEY);
       INSERT INTO ${fixture.gateTableName} (id) VALUES (1);`,
    );
    writeMigration(
      fixture,
      `CREATE TABLE ${fixture.tableName} (id INTEGER PRIMARY KEY);
       INSERT INTO ${fixture.gateTableName} (id) VALUES (1);`,
    );

    try {
      await expect(migrate(db, fixture.root)).rejects.toThrow();
      expect(await hasTable(db, fixture.tableName)).toBe(false);
      expect(await hasMigration(db, fixture.filename)).toBe(false);

      await db.execRaw(`DELETE FROM ${fixture.gateTableName} WHERE id = 1`);
      await expect(migrate(db, fixture.root)).resolves.toEqual([fixture.filename]);
      expect(await hasTable(db, fixture.tableName)).toBe(true);
      expect(await hasMigration(db, fixture.filename)).toBe(true);
    } finally {
      await cleanFixture(db, fixture);
      await db.close();
    }
  });

  it('allows concurrent callers to apply each migration exactly once', async () => {
    const primary = await openDatabase();
    const peer = await openDatabase(primary.databaseUrl);
    const fixture = createFixture(primary.db.dialect);
    writeMigration(
      fixture,
      `CREATE TABLE ${fixture.tableName} (id INTEGER PRIMARY KEY);
       INSERT INTO ${fixture.tableName} (id) VALUES (1);`,
    );

    try {
      const applied = await Promise.all([
        migrate(primary.db, fixture.root),
        migrate(peer.db, fixture.root),
      ]);

      expect(applied.flat()).toEqual([fixture.filename]);
      expect(await hasMigration(primary.db, fixture.filename)).toBe(true);
      const rows = await primary.db.get<{ count: number | string }>(
        sql.raw(`SELECT COUNT(*) AS count FROM ${fixture.tableName}`),
      );
      expect(Number(rows?.count)).toBe(1);
    } finally {
      await peer.db.close();
      await cleanFixture(primary.db, fixture);
      await primary.db.close();
    }
  });

  it.each([
    ['BEGIN', 'BEGIN;'],
    ['COMMIT', 'COMMIT;'],
    ['ROLLBACK', 'ROLLBACK;'],
    ['VACUUM', 'VACUUM;'],
    ['PRAGMA', 'PRAGMA foreign_keys = OFF;'],
    ['CREATE INDEX CONCURRENTLY', 'CREATE INDEX CONCURRENTLY unsafe_index ON target (id);'],
  ])('rejects unsafe %s before it executes', async (_name, unsafeStatement) => {
    const { db } = await openDatabase();
    const fixture = createFixture(db.dialect);
    writeMigration(
      fixture,
      `CREATE TABLE ${fixture.tableName} (id INTEGER PRIMARY KEY);
       ${unsafeStatement.replace('target', fixture.tableName)}`,
    );

    try {
      await expect(migrate(db, fixture.root)).rejects.toThrow(/unsafe migration statement/i);
      expect(await hasTable(db, fixture.tableName)).toBe(false);
      expect(await hasMigration(db, fixture.filename)).toBe(false);
    } finally {
      await cleanFixture(db, fixture);
      await db.close();
    }
  });
});
