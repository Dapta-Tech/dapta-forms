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
  `migrate-runtime-${process.pid}-${randomUUID()}`,
);

interface Fixture {
  root: string;
  filename: string;
  tableName: string;
  auditTableName: string;
  path: string;
}

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

function createDeferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createFixture(dialect: Db['dialect']): Fixture {
  const id = randomUUID().replaceAll('-', '');
  const root = join(TEST_ARTIFACT_ROOT, id);
  const directory = join(root, dialect);
  const filename = `${id}.sql`;

  mkdirSync(directory, { recursive: true });
  return {
    root,
    filename,
    tableName: `migrate_runtime_${id}`,
    auditTableName: `migrate_runtime_audit_${id}`,
    path: join(directory, filename),
  };
}

function writeMigration(fixture: Fixture, script: string): void {
  writeFileSync(fixture.path, script);
}

async function openDatabase(databaseUrl?: string): Promise<{ db: Db; databaseUrl: string }> {
  const resolvedUrl = databaseUrl ?? `file:${join(TEST_ARTIFACT_ROOT, `${randomUUID()}.db`)}`;
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

async function cleanFixture(db: Db, fixture: Fixture): Promise<void> {
  await db.execRaw(`DROP TABLE IF EXISTS ${fixture.tableName}`);
  await db.execRaw(`DROP TABLE IF EXISTS ${fixture.auditTableName}`);
  await db.run(sql`DELETE FROM _migrations WHERE name = ${fixture.filename}`);
}

function withForcedInitialProbeOverlap(db: Db, arrived: Deferred, release: Deferred): Db {
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

function isSqliteBusyOrLocked(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED'));
}

afterAll(() => {
  rmSync(TEST_ARTIFACT_ROOT, { recursive: true, force: true });
});

describe('migrate concurrency and recovery', () => {
  it('forces concurrent callers past the first probe and applies each file once', async () => {
    const primary = await openDatabase();
    const peer = await openDatabase(primary.databaseUrl);
    const fixture = createFixture(primary.db.dialect);
    const primaryArrived = createDeferred();
    const peerArrived = createDeferred();
    const release = createDeferred();
    writeMigration(fixture, `CREATE TABLE ${fixture.tableName} (id INTEGER PRIMARY KEY);`);

    try {
      const primaryMigration = migrate(
        withForcedInitialProbeOverlap(primary.db, primaryArrived, release),
        fixture.root,
      );
      const peerMigration = migrate(
        withForcedInitialProbeOverlap(peer.db, peerArrived, release),
        fixture.root,
      );
      await Promise.all([primaryArrived.promise, peerArrived.promise]);
      release.resolve();
      const applied = await Promise.all([primaryMigration, peerMigration]);

      expect(applied.flat()).toEqual([fixture.filename]);
      expect(await hasMigration(primary.db, fixture.filename)).toBe(true);
      expect(await hasTable(primary.db, fixture.tableName)).toBe(true);
    } finally {
      release.resolve();
      await peer.db.close();
      await cleanFixture(primary.db, fixture);
      await primary.db.close();
    }
  });

  it('retries SQLite BUSY until a peer applies the file', async () => {
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
    const primaryArrived = createDeferred();
    const release = createDeferred();
    let busyAttempts = 0;
    let peerTransactionOpen = false;
    primaryNative.txn = <T>(fn: () => T): T => {
      try {
        return originalTxn(fn);
      } catch (error) {
        if (isSqliteBusyOrLocked(error)) busyAttempts++;
        throw error;
      }
    };
    primaryNative.exec('PRAGMA busy_timeout = 0');
    writeMigration(fixture, `CREATE TABLE ${fixture.tableName} (id INTEGER PRIMARY KEY);`);

    try {
      const primaryMigration = migrate(
        withForcedInitialProbeOverlap(primary.db, primaryArrived, release),
        fixture.root,
      );
      await primaryArrived.promise;

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

      release.resolve();
      const outcomes = await Promise.allSettled([primaryMigration, peerMigration]);
      expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(busyAttempts).toBeGreaterThan(0);
      expect(
        outcomes.flatMap((outcome) => (outcome.status === 'fulfilled' ? outcome.value : [])),
      ).toEqual([fixture.filename]);
    } finally {
      release.resolve();
      primaryNative.txn = originalTxn;
      if (peerTransactionOpen) peerNative.exec('ROLLBACK');
      await peer.db.close();
      await cleanFixture(primary.db, fixture);
      await primary.db.close();
    }
  });

  it('retries a recognized SQLite LOCKED error', async () => {
    const { db } = await openDatabase();
    if (db.dialect !== 'sqlite') {
      await db.close();
      return;
    }

    const fixture = createFixture(db.dialect);
    const native = db.sqlite!;
    const originalTxn = native.txn;
    let attempts = 0;
    native.txn = <T>(fn: () => T): T => {
      attempts++;
      if (attempts === 1) {
        throw Object.assign(new Error('database table is locked'), { code: 'SQLITE_LOCKED' });
      }
      return originalTxn(fn);
    };
    writeMigration(fixture, `CREATE TABLE ${fixture.tableName} (id INTEGER PRIMARY KEY);`);

    try {
      await expect(migrate(db, fixture.root)).resolves.toEqual([fixture.filename]);
      expect(attempts).toBe(2);
      expect(await hasTable(db, fixture.tableName)).toBe(true);
    } finally {
      native.txn = originalTxn;
      await cleanFixture(db, fixture);
      await db.close();
    }
  });

  it('propagates a script error without probing for a marker that appears later', async () => {
    const { db } = await openDatabase();
    const fixture = createFixture(db.dialect);
    await db.execRaw(
      `CREATE TABLE ${fixture.auditTableName} (id INTEGER PRIMARY KEY);
       INSERT INTO ${fixture.auditTableName} (id) VALUES (1);`,
    );
    writeMigration(
      fixture,
      `CREATE TABLE ${fixture.tableName} (id INTEGER PRIMARY KEY);
       INSERT INTO ${fixture.auditTableName} (id) VALUES (1);`,
    );
    let probeCount = 0;
    const delayedMarkerDb: Db = {
      ...db,
      get: async <T>(query) => {
        probeCount++;
        if (probeCount === 3) {
          await db.run(
            sql`INSERT INTO _migrations (name, applied_at) VALUES (${fixture.filename}, ${Date.now()})`,
          );
        }
        return db.get<T>(query);
      },
    };

    try {
      await expect(migrate(delayedMarkerDb, fixture.root)).rejects.toThrow();
      expect(probeCount).toBe(2);
      expect(await hasMigration(db, fixture.filename)).toBe(false);
      expect(await hasTable(db, fixture.tableName)).toBe(false);
    } finally {
      await cleanFixture(db, fixture);
      await db.close();
    }
  });

  it('resolves only an exact marker unique conflict after a peer has applied the file', async () => {
    const { db } = await openDatabase();
    if (db.dialect !== 'sqlite') {
      await db.close();
      return;
    }

    const fixture = createFixture(db.dialect);
    await db.run(
      sql`INSERT INTO _migrations (name, applied_at) VALUES (${fixture.filename}, ${Date.now()})`,
    );
    writeMigration(fixture, `CREATE TABLE ${fixture.tableName} (id INTEGER PRIMARY KEY);`);
    const native = db.sqlite!;
    let hideOuterProbe = true;
    let hideInnerProbe = true;
    const hiddenMarkerDrizzle = new Proxy(native.drizzle, {
      get(target, property) {
        if (property === 'get') {
          return <T>(query: Parameters<typeof target.get>[0]): T | undefined => {
            if (hideInnerProbe) {
              hideInnerProbe = false;
              return undefined;
            }
            return target.get(query) as T | undefined;
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as typeof native.drizzle;
    const peerAppliedDb: Db = {
      ...db,
      get: async <T>(query) => {
        if (hideOuterProbe) {
          hideOuterProbe = false;
          return undefined;
        }
        return db.get<T>(query);
      },
      sqlite: { ...native, drizzle: hiddenMarkerDrizzle },
    };

    try {
      await expect(migrate(peerAppliedDb, fixture.root)).resolves.toEqual([]);
      expect(await hasMigration(db, fixture.filename)).toBe(true);
      expect(await hasTable(db, fixture.tableName)).toBe(false);
    } finally {
      await cleanFixture(db, fixture);
      await db.close();
    }
  });
});
