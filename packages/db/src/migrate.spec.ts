import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, sql, type Db, type Dialect } from './client';
import { migrate } from './migrate';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = join(HERE, '..', 'migrations');
const TEST_ROOT = join(HERE, '..', '..', '.data', `migrate-atomicity-${process.pid}-${randomUUID()}`);
const DIALECTS: Dialect[] = ['sqlite', 'postgres'];
const DATABASE_URL = process.env.DATABASE_URL;
const ACTIVE_DIALECT: Dialect =
  DATABASE_URL?.startsWith('postgres') || DATABASE_URL?.startsWith('postgresql')
    ? 'postgres'
    : 'sqlite';

interface State {
  tables: string[];
  indexes: string[];
  markers: string[];
}

interface Scratch {
  name: string;
  url: string;
  adminUrl: string;
}

let scratch: Scratch | undefined;

function filesFor(dialect: Dialect): string[] {
  const files = readdirSync(join(MIGRATIONS_ROOT, dialect))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  if (files.length === 0) throw new Error(`No ${dialect} migrations found`);
  return files;
}

const ACTIVE_FILES = filesFor(ACTIVE_DIALECT);

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function rootFor(dialect: Dialect, files: string[]): string {
  const root = join(TEST_ROOT, randomUUID());
  const directory = join(root, dialect);
  mkdirSync(directory, { recursive: true });
  for (const file of files) {
    copyFileSync(join(MIGRATIONS_ROOT, dialect, file), join(directory, file));
  }
  return root;
}

function customRoot(dialect: Dialect, file: string, script: string): string {
  const root = join(TEST_ROOT, randomUUID());
  const directory = join(root, dialect);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, file), script);
  return root;
}

async function createTestDb(): Promise<Db> {
  if (ACTIVE_DIALECT === 'sqlite') {
    return createDb(`file:${join(TEST_ROOT, `${randomUUID()}.db`)}`);
  }

  const db = await createDb(scratch!.url);
  await db.execRaw(`DROP SCHEMA public CASCADE; CREATE SCHEMA public`);
  return db;
}

async function trackingTable(db: Db): Promise<void> {
  await db.execRaw(
    `CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)`,
  );
}

async function state(db: Db): Promise<State> {
  if (db.dialect === 'sqlite') {
    const tables = await db.all<{ name: string }>(
      sql.raw(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`),
    );
    const indexes = await db.all<{ name: string }>(
      sql.raw(`SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name`),
    );
    const markers = await db.all<{ name: string }>(sql.raw(`SELECT name FROM _migrations ORDER BY name`));
    return {
      tables: tables.map((row) => row.name),
      indexes: indexes.map((row) => row.name),
      markers: markers.map((row) => row.name),
    };
  }

  const tables = await db.all<{ table_name: string }>(
    sql.raw(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    ),
  );
  const indexes = await db.all<{ indexname: string }>(
    sql.raw(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`),
  );
  const markers = await db.all<{ name: string }>(sql.raw(`SELECT name FROM _migrations ORDER BY name`));
  return {
    tables: tables.map((row) => row.table_name),
    indexes: indexes.map((row) => row.indexname),
    markers: markers.map((row) => row.name),
  };
}

async function installMarkerFailure(db: Db, file: string, suffix: string): Promise<() => Promise<void>> {
  const trigger = `migration_marker_fail_${suffix}`;
  if (db.dialect === 'sqlite') {
    await db.execRaw(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON _migrations
       WHEN NEW.name = '${file}'
       BEGIN SELECT RAISE(ABORT, 'marker failure'); END;`,
    );
    return async () => {
      await db.execRaw(`DROP TRIGGER IF EXISTS ${trigger}`);
    };
  }

  const fn = `migration_marker_fail_fn_${suffix}`;
  await db.execRaw(
    `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $marker$
     BEGIN
       IF NEW.name = '${file}' THEN RAISE EXCEPTION 'marker failure'; END IF;
       RETURN NEW;
     END;
     $marker$;
     CREATE TRIGGER ${trigger} BEFORE INSERT ON _migrations
       FOR EACH ROW EXECUTE FUNCTION ${fn}();`,
  );
  return async () => {
    await db.execRaw(`DROP TRIGGER IF EXISTS ${trigger} ON _migrations`);
    await db.execRaw(`DROP FUNCTION IF EXISTS ${fn}()`);
  };
}

async function prepareBase(db: Db): Promise<void> {
  await trackingTable(db);
  await expect(migrate(db, rootFor(ACTIVE_DIALECT, [ACTIVE_FILES[0]!]))).resolves.toEqual([
    ACTIVE_FILES[0],
  ]);
}

async function assertCorpusRollback(file: string, index: number): Promise<void> {
  const db = await createTestDb();
  const prefix = ACTIVE_FILES.slice(0, index);
  const root = rootFor(ACTIVE_DIALECT, ACTIVE_FILES.slice(0, index + 1));
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);

  try {
    await trackingTable(db);
    if (prefix.length > 0) {
      await expect(migrate(db, rootFor(ACTIVE_DIALECT, prefix))).resolves.toEqual(prefix);
    }
    const before = await state(db);
    const removeFailure = await installMarkerFailure(db, file, suffix);
    try {
      await expect(migrate(db, root)).rejects.toThrow('marker failure');
    } finally {
      await removeFailure();
    }
    expect(await state(db)).toEqual(before);
    await expect(migrate(db, root)).resolves.toEqual([file]);
  } finally {
    await db.close();
  }
}

function withInitialBarrier(db: Db, arrived: Promise<void>, release: Promise<void>): Db {
  let first = true;
  return {
    ...db,
    get: async <T>(query) => {
      const result = await db.get<T>(query);
      if (first) {
        first = false;
        await arrived;
        await release;
      }
      return result;
    },
  };
}

beforeAll(async () => {
  if (ACTIVE_DIALECT !== 'postgres') return;
  const base = new URL(DATABASE_URL!);
  const admin = new URL(base);
  admin.pathname = '/postgres';
  const name = `migration_atomicity_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const client = postgres(admin.toString(), { max: 1 });
  try {
    await client.unsafe(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)}`);
    await client.unsafe(`CREATE DATABASE ${quoteIdentifier(name)}`);
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
        await admin.unsafe(`DROP DATABASE IF EXISTS ${quoteIdentifier(scratch.name)}`);
      } finally {
        await admin.end({ timeout: 5 });
      }
    }
  } finally {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
});

describe('migration atomicity', () => {
  it('discovers non-empty sorted shipped migration directories', () => {
    for (const dialect of DIALECTS) {
      const files = filesFor(dialect);
      expect(files).toEqual([...files].sort());
      expect(files.length).toBeGreaterThan(0);
    }
  });

  it('rolls back a SQLite mid-script failure', async () => {
    if (ACTIVE_DIALECT !== 'sqlite') return;
    const db = await createTestDb();
    const file = '9000_mid_script.sql';
    const table = 'mid_script_table';
    const root = customRoot(
      'sqlite',
      file,
      `CREATE TABLE ${table} (id INTEGER PRIMARY KEY);
       INSERT INTO ${table} (id) VALUES (1);
       INSERT INTO ${table} (id) VALUES (1);`,
    );

    try {
      await trackingTable(db);
      const before = await state(db);
      await expect(migrate(db, root)).rejects.toThrow();
      expect(await state(db)).toEqual(before);
    } finally {
      await db.close();
    }
  });

  it('rolls back a failed marker insert', async () => {
    const db = await createTestDb();
    const file = '9001_marker_failure.sql';
    const table = 'marker_failure_table';
    const root = customRoot(ACTIVE_DIALECT, file, `CREATE TABLE ${table} (id INTEGER PRIMARY KEY);`);

    try {
      await trackingTable(db);
      const before = await state(db);
      const removeFailure = await installMarkerFailure(db, file, 'marker_failure');
      try {
        await expect(migrate(db, root)).rejects.toThrow('marker failure');
      } finally {
        await removeFailure();
      }
      expect(await state(db)).toEqual(before);
    } finally {
      await db.close();
    }
  });

  it('rolls back a PostgreSQL script when its marker fails', async () => {
    if (ACTIVE_DIALECT !== 'postgres') return;
    const db = await createTestDb();
    const file = '9002_pg_marker_failure.sql';
    const root = customRoot('postgres', file, `CREATE TABLE pg_marker_failure (id INTEGER PRIMARY KEY);`);

    try {
      await trackingTable(db);
      const before = await state(db);
      const removeFailure = await installMarkerFailure(db, file, 'pg_marker_failure');
      try {
        await expect(migrate(db, root)).rejects.toThrow('marker failure');
      } finally {
        await removeFailure();
      }
      expect(await state(db)).toEqual(before);
    } finally {
      await db.close();
    }
  });

  for (const [index, file] of ACTIVE_FILES.entries()) {
    it(`rolls back shipped migration ${file} with its marker`, async () => {
      await assertCorpusRollback(file, index);
    });
  }

  it('applies a concurrent migration exactly once', async () => {
    const databaseUrl =
      ACTIVE_DIALECT === 'sqlite'
        ? `file:${join(TEST_ROOT, `${randomUUID()}.db`)}`
        : scratch!.url;
    const primary = await createDb(databaseUrl);
    const peer = await createDb(databaseUrl);
    const file = '9003_concurrent.sql';
    const table = 'concurrent_probe';
    const root = customRoot(
      ACTIVE_DIALECT,
      file,
      `INSERT INTO ${table} (id) VALUES (1) ON CONFLICT DO NOTHING;`,
    );
    let release!: () => void;
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    let primaryReady!: () => void;
    let peerReady!: () => void;
    const primaryReadyPromise = new Promise<void>((resolve) => {
      primaryReady = resolve;
    });
    const peerReadyPromise = new Promise<void>((resolve) => {
      peerReady = resolve;
    });

    try {
      if (ACTIVE_DIALECT === 'postgres') {
        await primary.execRaw(`DROP SCHEMA public CASCADE; CREATE SCHEMA public`);
      }
      await prepareBase(primary);
      await primary.execRaw(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY)`);
      const first = withInitialBarrier(primary, primaryReadyPromise, releasePromise);
      const second = withInitialBarrier(peer, peerReadyPromise, releasePromise);
      const primaryMigration = migrate(first, root);
      primaryReady();
      const peerMigration = migrate(second, root);
      peerReady();
      await Promise.all([primaryReadyPromise, peerReadyPromise]);
      release();
      const applied = await Promise.all([primaryMigration, peerMigration]);
      expect(applied.flat()).toEqual([file]);
      const rows = await primary.get<{ count: number | string }>(
        sql.raw(`SELECT COUNT(*) AS count FROM ${table}`),
      );
      expect(Number(rows?.count)).toBe(1);
      expect(await primary.get<{ name: string }>(sql`SELECT name FROM _migrations WHERE name = ${file}`)).toBeTruthy();
    } finally {
      release?.();
      await peer.close();
      await primary.close();
    }
  });

  it('retries SQLite busy contention introduced by the wrapper', async () => {
    if (ACTIVE_DIALECT !== 'sqlite') return;
    const url = `file:${join(TEST_ROOT, `${randomUUID()}.db`)}`;
    const primary = await createDb(url);
    const peer = await createDb(url);
    const file = '9004_busy_retry.sql';
    const root = customRoot(
      'sqlite',
      file,
      `INSERT INTO busy_retry_probe (id) VALUES (1) ON CONFLICT DO NOTHING;`,
    );
    let ready!: () => void;
    let release!: () => void;
    const readyPromise = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstProbe = true;

    try {
      await prepareBase(primary);
      await primary.execRaw(`CREATE TABLE busy_retry_probe (id INTEGER PRIMARY KEY)`);
      primary.sqlite!.exec('PRAGMA busy_timeout = 0');
      const gatedPrimary: Db = {
        ...primary,
        get: async <T>(query) => {
          const result = await primary.get<T>(query);
          if (firstProbe) {
            firstProbe = false;
            ready();
            await releasePromise;
          }
          return result;
        },
      };
      const primaryApply = migrate(gatedPrimary, root);
      await readyPromise;
      peer.sqlite!.exec('BEGIN IMMEDIATE');
      const peerApply = (async () => {
        const applied = await migrate(peer, root);
        await new Promise((resolve) => setTimeout(resolve, 30));
        peer.sqlite!.exec('COMMIT');
        return applied;
      })();
      release();
      const applied = await primaryApply;
      const peerResult = await peerApply;
      expect([...applied, ...peerResult]).toEqual([file]);
    } finally {
      release?.();
      await peer.close();
      await primary.close();
    }
  });

  it('fails the rollback oracle without the native wrapper', async () => {
    const db = await createTestDb();
    if (db.dialect !== 'sqlite') {
      await db.close();
      return;
    }
    const table = 'wrong_wrapper_probe';

    try {
      await trackingTable(db);
      const before = await state(db);
      let failed = false;
      try {
        await db.execRaw(
          `CREATE TABLE ${table} (id INTEGER PRIMARY KEY);
           INSERT INTO ${table} (id) VALUES (1);
           INSERT INTO ${table} (id) VALUES (1);`,
        );
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
      expect(await state(db)).not.toEqual(before);
    } finally {
      await db.close();
    }
  });
});
