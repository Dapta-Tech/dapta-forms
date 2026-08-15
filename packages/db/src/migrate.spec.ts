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
  auditTableName: string;
  markerTriggerName: string;
  path: string;
}

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

interface Barrier {
  wait(): Promise<void>;
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
    auditTableName: `migration_atomicity_audit_${id}`,
    markerTriggerName: `migration_atomicity_marker_${id}`,
    path,
  };
}

function createDeferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createBarrier(parties: number): Barrier {
  const released = createDeferred();
  let arrivals = 0;

  return {
    async wait(): Promise<void> {
      arrivals++;
      if (arrivals === parties) released.resolve();
      await released.promise;
    },
  };
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function writeMigration(fixture: MigrationFixture, script: string): void {
  writeFileSync(fixture.path, script);
}

function withInitialProbeBarrier(db: Db, barrier: Barrier): Db {
  let firstProbe = true;
  return {
    ...db,
    get: async <T>(query) => {
      const row = await db.get<T>(query);
      if (firstProbe) {
        firstProbe = false;
        await barrier.wait();
      }
      return row;
    },
  };
}

function withPausedInitialProbe(db: Db, arrived: Deferred, release: Deferred): Db {
  let firstProbe = true;
  return {
    ...db,
    get: async <T>(query) => {
      const row = await db.get<T>(query);
      if (firstProbe) {
        firstProbe = false;
        arrived.resolve();
        await release.promise;
      }
      return row;
    },
  };
}

function isSqliteBusy(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('SQLITE_BUSY');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

async function countRows(db: Db, tableName: string): Promise<number> {
  const row = await db.get<{ count: number | string }>(sql.raw(`SELECT COUNT(*) AS count FROM ${tableName}`));
  return Number(row?.count ?? 0);
}

async function createDurableEffects(db: Db, fixture: MigrationFixture): Promise<void> {
  await db.execRaw(
    `CREATE TABLE ${fixture.gateTableName} (id INTEGER PRIMARY KEY);
     CREATE TABLE ${fixture.auditTableName} (id INTEGER PRIMARY KEY);
     INSERT INTO ${fixture.gateTableName} (id) VALUES (1);`,
  );
}

async function captureMigrationError(db: Db, fixture: MigrationFixture): Promise<unknown> {
  return migrate(db, fixture.root).then(
    () => undefined,
    (error: unknown) => error,
  );
}

function expectGuardError(
  error: unknown,
  db: Db,
  fixture: MigrationFixture,
  classification: string,
): void {
  const message = errorMessage(error);
  expect(message).toBe(`Unsafe ${db.dialect} migration statement: ${classification}.`);
  expect(message).not.toContain(fixture.filename);
}

async function expectNoDurableEffects(db: Db, fixture: MigrationFixture): Promise<void> {
  expect(await hasTable(db, fixture.tableName)).toBe(false);
  expect(await countRows(db, fixture.auditTableName)).toBe(0);
  expect(await hasMigration(db, fixture.filename)).toBe(false);
}

async function cleanFixture(db: Db, fixture: MigrationFixture): Promise<void> {
  if (db.dialect === 'sqlite') {
    await db.execRaw(`DROP TRIGGER IF EXISTS ${fixture.markerTriggerName}`);
  }
  await db.execRaw(`DROP TABLE IF EXISTS ${fixture.tableName}`);
  await db.execRaw(`DROP TABLE IF EXISTS ${fixture.gateTableName}`);
  await db.execRaw(`DROP TABLE IF EXISTS ${fixture.auditTableName}`);
  await db.run(sql`DELETE FROM _migrations WHERE name = ${fixture.filename}`);
}

afterAll(() => {
  rmSync(TEST_ARTIFACT_ROOT, { recursive: true, force: true });
});

describe('migrate atomicity', () => {
  it('rejects END before DDL and DML can escape the wrapper transaction', async () => {
    const { db } = await openDatabase();
    const fixture = createFixture(db.dialect);
    await createDurableEffects(db, fixture);
    writeMigration(
      fixture,
      `END;
       CREATE TABLE ${fixture.tableName} (id INTEGER PRIMARY KEY);
       INSERT INTO ${fixture.auditTableName} (id) VALUES (1);
       INSERT INTO ${fixture.gateTableName} (id) VALUES (1);`,
    );

    try {
      const error = await captureMigrationError(db, fixture);
      await expectNoDurableEffects(db, fixture);
      expectGuardError(error, db, fixture, 'outer transaction control');
    } finally {
      await cleanFixture(db, fixture);
      await db.close();
    }
  });

  it.each([
    ['a standard backslash quote boundary', `SELECT 'backslash\\';`],
    ['a doubled quote boundary', `SELECT 'doubled '' quote';`],
  ])('rejects END after %s', async (_label, quotedStatement) => {
    const { db } = await openDatabase();
    const fixture = createFixture(db.dialect);
    await createDurableEffects(db, fixture);
    writeMigration(
      fixture,
      `${quotedStatement}
       END;
       CREATE TABLE ${fixture.tableName} (id INTEGER PRIMARY KEY);
       INSERT INTO ${fixture.auditTableName} (id) VALUES (1);
       INSERT INTO ${fixture.gateTableName} (id) VALUES (1);`,
    );

    try {
      const error = await captureMigrationError(db, fixture);
      await expectNoDurableEffects(db, fixture);
      expectGuardError(error, db, fixture, 'outer transaction control');
    } finally {
      await cleanFixture(db, fixture);
      await db.close();
    }
  });

  it.each([
    ['BEGIN', 'BEGIN;', 'outer transaction control'],
    ['END WORK', 'END WORK;', 'outer transaction control'],
    ['END TRANSACTION', 'END TRANSACTION;', 'outer transaction control'],
    ['COMMIT', 'COMMIT;', 'outer transaction control'],
    ['ROLLBACK', 'ROLLBACK;', 'outer transaction control'],
    ['VACUUM', 'VACUUM;', 'transaction-incompatible VACUUM'],
    ['PRAGMA', 'PRAGMA foreign_keys = OFF;', 'unsafe PRAGMA'],
    [
      'CREATE INDEX CONCURRENTLY',
      'CREATE INDEX CONCURRENTLY migration_atomicity_unsafe_index ON target (id);',
      'transaction-incompatible CREATE INDEX CONCURRENTLY',
    ],
  ])('rejects unsafe %s before it executes', async (_label, unsafeStatement, classification) => {
    const { db } = await openDatabase();
    const fixture = createFixture(db.dialect);
    writeMigration(
      fixture,
      `CREATE TABLE ${fixture.tableName} (id INTEGER PRIMARY KEY);
       ${unsafeStatement.replace('target', fixture.tableName)}`,
    );

    try {
      const error = await captureMigrationError(db, fixture);
      expect(await hasTable(db, fixture.tableName)).toBe(false);
      expect(await hasMigration(db, fixture.filename)).toBe(false);
      expectGuardError(error, db, fixture, classification);
    } finally {
      await cleanFixture(db, fixture);
      await db.close();
    }
  });

  it('allows nested savepoints and SQLite local foreign-key deferral', async () => {
    const { db } = await openDatabase();
    const fixture = createFixture(db.dialect);
    await db.execRaw(`CREATE TABLE ${fixture.auditTableName} (id INTEGER PRIMARY KEY)`);
    const safeStatements =
      db.dialect === 'sqlite'
        ? `PRAGMA defer_foreign_keys = ON;
           SAVEPOINT nested;
           INSERT INTO ${fixture.auditTableName} (id) VALUES (1);
           ROLLBACK TO SAVEPOINT nested;
           RELEASE SAVEPOINT nested;`
        : `SAVEPOINT nested;
           INSERT INTO ${fixture.auditTableName} (id) VALUES (1);
           ROLLBACK TO SAVEPOINT nested;
           RELEASE SAVEPOINT nested;`;
    writeMigration(
      fixture,
      `${safeStatements}
       CREATE TABLE ${fixture.tableName} (id INTEGER PRIMARY KEY);`,
    );

    try {
      await expect(migrate(db, fixture.root)).resolves.toEqual([fixture.filename]);
      expect(await hasTable(db, fixture.tableName)).toBe(true);
      expect(await countRows(db, fixture.auditTableName)).toBe(0);
      expect(await hasMigration(db, fixture.filename)).toBe(true);
    } finally {
      await cleanFixture(db, fixture);
      await db.close();
    }
  });

  it('allows quoted transaction words and PostgreSQL dollar-quoted bodies', async () => {
    const { db } = await openDatabase();
    const fixture = createFixture(db.dialect);
    const quotedStatement =
      db.dialect === 'postgres'
        ? `DO $migration_guard$ BEGIN PERFORM 'END;'; END $migration_guard$;`
        : `SELECT 'END;'; SELECT 'doubled '' quote';`;
    writeMigration(
      fixture,
      `${quotedStatement}
       CREATE TABLE ${fixture.tableName} (id INTEGER PRIMARY KEY);`,
    );

    try {
      await expect(migrate(db, fixture.root)).resolves.toEqual([fixture.filename]);
      expect(await hasTable(db, fixture.tableName)).toBe(true);
      expect(await hasMigration(db, fixture.filename)).toBe(true);
    } finally {
      await cleanFixture(db, fixture);
      await db.close();
    }
  });

  it('rolls back DDL and DML when inserting the migration marker fails', async () => {
    const { db } = await openDatabase();
    if (db.dialect !== 'sqlite') {
      await db.close();
      return;
    }

    const fixture = createFixture(db.dialect);
    await db.execRaw(
      `CREATE TABLE ${fixture.auditTableName} (id INTEGER PRIMARY KEY);
       CREATE TRIGGER ${fixture.markerTriggerName}
       BEFORE INSERT ON _migrations
       WHEN NEW.name = '${fixture.filename}'
       BEGIN
         SELECT RAISE(ABORT, 'marker insertion failed');
       END;`,
    );
    writeMigration(
      fixture,
      `CREATE TABLE ${fixture.tableName} (id INTEGER PRIMARY KEY);
       INSERT INTO ${fixture.auditTableName} (id) VALUES (1);`,
    );

    try {
      await expect(migrate(db, fixture.root)).rejects.toThrow('marker insertion failed');
      await expectNoDurableEffects(db, fixture);
    } finally {
      await cleanFixture(db, fixture);
      await db.close();
    }
  });

  it('forces both callers past the marker probe and applies the migration once', async () => {
    const primary = await openDatabase();
    const peer = await openDatabase(primary.databaseUrl);
    const fixture = createFixture(primary.db.dialect);
    const barrier = createBarrier(2);
    writeMigration(
      fixture,
      `CREATE TABLE ${fixture.tableName} (id INTEGER PRIMARY KEY);
       INSERT INTO ${fixture.tableName} (id) VALUES (1);`,
    );

    try {
      const applied = await Promise.all([
        migrate(withInitialProbeBarrier(primary.db, barrier), fixture.root),
        migrate(withInitialProbeBarrier(peer.db, barrier), fixture.root),
      ]);

      expect(applied.flat()).toEqual([fixture.filename]);
      expect(await hasMigration(primary.db, fixture.filename)).toBe(true);
      expect(await countRows(primary.db, fixture.tableName)).toBe(1);
    } finally {
      await peer.db.close();
      await cleanFixture(primary.db, fixture);
      await primary.db.close();
    }
  });

  it('retries SQLite busy errors until a peer applies the migration', async () => {
    const primary = await openDatabase();
    if (primary.db.dialect !== 'sqlite') {
      await primary.db.close();
      return;
    }

    const peer = await openDatabase(primary.databaseUrl);
    const fixture = createFixture(primary.db.dialect);
    const primaryNative = primary.db.sqlite!;
    const peerNative = peer.db.sqlite!;
    const originalTxn = primaryNative.txn;
    const primaryAtProbe = createDeferred();
    const releasePrimary = createDeferred();
    let busyAttempts = 0;
    let peerTransactionOpen = false;
    primaryNative.txn = <T>(fn: () => T): T => {
      try {
        return originalTxn(fn);
      } catch (error) {
        if (isSqliteBusy(error)) busyAttempts++;
        throw error;
      }
    };
    primaryNative.exec('PRAGMA busy_timeout = 0');
    writeMigration(fixture, `CREATE TABLE ${fixture.tableName} (id INTEGER PRIMARY KEY);`);

    try {
      const primaryMigration = migrate(
        withPausedInitialProbe(primary.db, primaryAtProbe, releasePrimary),
        fixture.root,
      );
      await primaryAtProbe.promise;

      peerNative.exec('BEGIN IMMEDIATE');
      peerTransactionOpen = true;
      const peerMigration = (async () => {
        try {
          const applied = await migrate(peer.db, fixture.root);
          await pause(30);
          peerNative.exec('COMMIT');
          peerTransactionOpen = false;
          return applied;
        } catch (error) {
          if (peerTransactionOpen) {
            peerNative.exec('ROLLBACK');
            peerTransactionOpen = false;
          }
          throw error;
        }
      })();

      releasePrimary.resolve();
      const outcomes = await Promise.allSettled([primaryMigration, peerMigration]);

      expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(busyAttempts).toBeGreaterThan(0);
      expect(
        outcomes.flatMap((outcome) => (outcome.status === 'fulfilled' ? outcome.value : [])),
      ).toEqual([fixture.filename]);
      expect(await hasMigration(primary.db, fixture.filename)).toBe(true);
      expect(await hasTable(primary.db, fixture.tableName)).toBe(true);
    } finally {
      releasePrimary.resolve();
      primaryNative.txn = originalTxn;
      if (peerTransactionOpen) peerNative.exec('ROLLBACK');
      await peer.db.close();
      await cleanFixture(primary.db, fixture);
      await primary.db.close();
    }
  });
});
