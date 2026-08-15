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
const TEST_ARTIFACT_ROOT = join(
  HERE,
  '..',
  '..',
  '.data',
  `migration-contract-${process.pid}-${randomUUID()}`,
);
const DIALECTS: Dialect[] = ['sqlite', 'postgres'];
const ACTIVE_DIALECT: Dialect =
  process.env.DATABASE_URL?.startsWith('postgres') || process.env.DATABASE_URL?.startsWith('postgresql')
    ? 'postgres'
    : 'sqlite';

interface Snapshot {
  tables: string[];
  indexes: string[];
  migrations: string[];
  userVersion?: number;
  applicationId?: number;
  journalMode?: string;
}

interface PostgresScratch {
  databaseName: string;
  databaseUrl: string;
  adminUrl: string;
}

let postgresScratch: PostgresScratch | undefined;

function migrationFiles(dialect: Dialect): string[] {
  const files = readdirSync(join(MIGRATIONS_ROOT, dialect))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  if (files.length === 0) throw new Error(`No ${dialect} migrations found`);
  return files;
}

const ACTIVE_FILES = migrationFiles(ACTIVE_DIALECT);

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function createRoot(dialect: Dialect, files: string[]): string {
  const root = join(TEST_ARTIFACT_ROOT, randomUUID());
  const directory = join(root, dialect);
  mkdirSync(directory, { recursive: true });
  for (const file of files) {
    copyFileSync(join(MIGRATIONS_ROOT, dialect, file), join(directory, file));
  }
  return root;
}

async function trackingTableExists(db: Db): Promise<boolean> {
  if (db.dialect === 'sqlite') {
    return Boolean(
      await db.get<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_migrations' LIMIT 1`,
      ),
    );
  }
  return Boolean(
    await db.get<{ table_name: string }>(
      sql`SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = '_migrations'
          LIMIT 1`,
    ),
  );
}

async function createTrackingTable(db: Db): Promise<void> {
  await db.execRaw(
    `CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)`,
  );
}

async function snapshot(db: Db): Promise<Snapshot> {
  if (db.dialect === 'sqlite') {
    const tables = await db.all<{ name: string }>(
      sql.raw(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      ),
    );
    const indexes = await db.all<{ name: string }>(
      sql.raw(
        `SELECT name FROM sqlite_master
         WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex%'
         ORDER BY name`,
      ),
    );
    const migrations = await db.all<{ name: string }>(
      sql.raw(`SELECT name FROM _migrations ORDER BY name`),
    );
    const userVersion = await db.get<{ user_version: number }>(sql.raw(`PRAGMA user_version`));
    const applicationId = await db.get<{ application_id: number }>(sql.raw(`PRAGMA application_id`));
    const journalMode = await db.get<{ journal_mode: string }>(sql.raw(`PRAGMA journal_mode`));
    return {
      tables: tables.map((row) => row.name),
      indexes: indexes.map((row) => row.name),
      migrations: migrations.map((row) => row.name),
      userVersion: Number(userVersion?.user_version),
      applicationId: Number(applicationId?.application_id),
      journalMode: journalMode?.journal_mode,
    };
  }

  const tables = await db.all<{ table_name: string }>(
    sql.raw(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`,
    ),
  );
  const indexes = await db.all<{ indexname: string }>(
    sql.raw(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public'
       ORDER BY indexname`,
    ),
  );
  const migrations = await db.all<{ name: string }>(sql.raw(`SELECT name FROM _migrations ORDER BY name`));
  return {
    tables: tables.map((row) => row.table_name),
    indexes: indexes.map((row) => row.indexname),
    migrations: migrations.map((row) => row.name),
  };
}

async function installMarkerFailure(db: Db, file: string, suffix: string): Promise<() => Promise<void>> {
  const triggerName = `migration_contract_marker_${suffix}`;
  if (db.dialect === 'sqlite') {
    await db.execRaw(
      `CREATE TRIGGER ${triggerName}
       BEFORE INSERT ON _migrations
       WHEN NEW.name = ${quoteLiteral(file)}
       BEGIN
         SELECT RAISE(ABORT, 'migration contract marker failure');
       END;`,
    );
    return async () => {
      await db.execRaw(`DROP TRIGGER IF EXISTS ${triggerName}`);
    };
  }

  const functionName = `migration_contract_marker_fn_${suffix}`;
  await db.execRaw(
    `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $contract$
     BEGIN
       IF NEW.name = ${quoteLiteral(file)} THEN
         RAISE EXCEPTION 'migration contract marker failure';
       END IF;
       RETURN NEW;
     END;
     $contract$;
     CREATE TRIGGER ${triggerName}
     BEFORE INSERT ON _migrations
     FOR EACH ROW EXECUTE FUNCTION ${functionName}();`,
  );
  return async () => {
    await db.execRaw(`DROP TRIGGER IF EXISTS ${triggerName} ON _migrations`);
    await db.execRaw(`DROP FUNCTION IF EXISTS ${functionName}()`);
  };
}

async function createContractDb(): Promise<Db> {
  if (ACTIVE_DIALECT === 'sqlite') {
    return createDb(`file:${join(TEST_ARTIFACT_ROOT, `${randomUUID()}.db`)}`);
  }

  const db = await createDb(postgresScratch!.databaseUrl);
  await db.execRaw(`DROP SCHEMA public CASCADE; CREATE SCHEMA public`);
  return db;
}

async function assertRollbackForFile(file: string, index: number): Promise<void> {
  const db = await createContractDb();
  const prefix = ACTIVE_FILES.slice(0, index);
  const root = createRoot(ACTIVE_DIALECT, ACTIVE_FILES.slice(0, index + 1));
  const suffix = randomUUID().replaceAll('-', '');

  try {
    expect(await trackingTableExists(db)).toBe(false);
    await createTrackingTable(db);
    if (prefix.length > 0) {
      await expect(migrate(db, createRoot(ACTIVE_DIALECT, prefix))).resolves.toEqual(prefix);
    }

    const before = await snapshot(db);
    const removeMarkerFailure = await installMarkerFailure(db, file, suffix);
    try {
      await expect(migrate(db, root)).rejects.toThrow('migration contract marker failure');
    } finally {
      await removeMarkerFailure();
    }

    expect(await snapshot(db)).toEqual(before);
    expect(before.migrations).not.toContain(file);
    await expect(migrate(db, root)).resolves.toEqual([file]);
    expect(await snapshot(db).then((state) => state.migrations)).toContain(file);
  } finally {
    await db.close();
  }
}

async function assertPartialApplyDanger(): Promise<void> {
  const db = await createContractDb();
  const suffix = randomUUID().replaceAll('-', '');
  const file = `0001_partial_apply_${suffix}.sql`;
  const tableName = `migration_contract_partial_${suffix}`;
  const auditTableName = `migration_contract_audit_${suffix}`;
  const root = join(TEST_ARTIFACT_ROOT, randomUUID());
  const directory = join(root, ACTIVE_DIALECT);

  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, file),
    `END;
     CREATE TABLE ${tableName} (id INTEGER PRIMARY KEY);
     INSERT INTO ${auditTableName} (id) VALUES (1);`,
  );

  try {
    expect(await trackingTableExists(db)).toBe(false);
    await createTrackingTable(db);
    await db.execRaw(`CREATE TABLE ${auditTableName} (id INTEGER PRIMARY KEY)`);
    const before = await snapshot(db);

    const removeMarkerFailure = await installMarkerFailure(db, file, suffix);
    try {
      await expect(migrate(db, root)).rejects.toThrow('migration contract marker failure');
    } finally {
      await removeMarkerFailure();
    }
    const after = await snapshot(db);

    expect(after).not.toEqual(before);
    expect(after.migrations).not.toContain(file);
    expect(
      after.tables.includes(tableName) ||
        Number(
          await db
            .get<{ count: number | string }>(sql.raw(`SELECT COUNT(*) AS count FROM ${auditTableName}`))
            .then((row) => row?.count ?? 0),
        ) > 0,
    ).toBe(true);
  } finally {
    await db.close();
  }
}

async function assertScriptErrorDoesNotRecoverFromLaterMarker(): Promise<void> {
  const db = await createContractDb();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 24);
  const file = `0001_script_failure_${suffix}.sql`;
  const tableName = `migration_contract_script_${suffix}`;
  const auditTableName = `migration_contract_script_audit_${suffix}`;
  const root = join(TEST_ARTIFACT_ROOT, randomUUID());
  const directory = join(root, ACTIVE_DIALECT);
  let probes = 0;

  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, file),
    `CREATE TABLE ${tableName} (id INTEGER PRIMARY KEY);
     INSERT INTO ${auditTableName} (id) VALUES (1);`,
  );

  try {
    expect(await trackingTableExists(db)).toBe(false);
    await createTrackingTable(db);
    await db.execRaw(
      `CREATE TABLE ${auditTableName} (id INTEGER PRIMARY KEY);
       INSERT INTO ${auditTableName} (id) VALUES (1);`,
    );
    const delayedMarkerDb: Db = {
      ...db,
      get: async <T>(query) => {
        probes++;
        if (probes === 2) {
          await db.run(sql`INSERT INTO _migrations (name, applied_at) VALUES (${file}, ${Date.now()})`);
        }
        return db.get<T>(query);
      },
    };

    await expect(migrate(delayedMarkerDb, root)).rejects.toThrow();
    expect(probes).toBe(1);
    expect(await snapshot(db).then((state) => state.migrations)).not.toContain(file);
    expect(await snapshot(db).then((state) => state.tables)).not.toContain(tableName);
  } finally {
    await db.close();
  }
}

beforeAll(async () => {
  if (ACTIVE_DIALECT !== 'postgres') return;

  const baseUrl = new URL(process.env.DATABASE_URL!);
  const adminUrl = new URL(baseUrl);
  adminUrl.pathname = '/postgres';
  const databaseName = `migration_contract_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const admin = postgres(adminUrl.toString(), { max: 1 });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
    await admin.unsafe(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  baseUrl.pathname = `/${databaseName}`;
  postgresScratch = {
    databaseName,
    databaseUrl: baseUrl.toString(),
    adminUrl: adminUrl.toString(),
  };
});

afterAll(async () => {
  try {
    if (postgresScratch) {
      const admin = postgres(postgresScratch.adminUrl, { max: 1 });
      try {
        await admin.unsafe(`DROP DATABASE IF EXISTS ${quoteIdentifier(postgresScratch.databaseName)}`);
      } finally {
        await admin.end({ timeout: 5 });
      }
    }
  } finally {
    rmSync(TEST_ARTIFACT_ROOT, { recursive: true, force: true });
  }
});

describe('migration contract', () => {
  it('discovers non-empty sorted migration directories at runtime', () => {
    for (const dialect of DIALECTS) {
      const files = migrationFiles(dialect);
      expect(files.length).toBeGreaterThan(0);
      expect(files).toEqual([...files].sort());
    }
  });

  for (const [index, file] of ACTIVE_FILES.entries()) {
    it(`rolls back ${file} with its marker`, async () => {
      await assertRollbackForFile(file, index);
    });
  }

  it('detects the one partial-apply marker-danger fixture for the active dialect', async () => {
    await assertPartialApplyDanger();
  });

  it('propagates script failures without a later marker recovery probe', async () => {
    await assertScriptErrorDoesNotRecoverFromLaterMarker();
  });
});
