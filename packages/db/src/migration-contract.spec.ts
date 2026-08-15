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
const DATABASE_URL = process.env.DATABASE_URL;
const POSTGRES_CONFIGURED = Boolean(
  DATABASE_URL?.startsWith('postgres') || DATABASE_URL?.startsWith('postgresql'),
);
const POSTGRES_REQUIRED = process.env.MIGRATION_CONTRACT_POSTGRES_REQUIRED === 'true';
const ACTIVE_DIALECT: Dialect = POSTGRES_CONFIGURED ? 'postgres' : 'sqlite';

interface Snapshot {
  tables: string[];
  rows: Record<string, string[]>;
  columns: Record<string, string[]>;
  indexes: string[];
  triggers: string[];
  constraints: Record<string, string[]>;
  migrations: string[];
  userVersion?: number;
  applicationId?: number;
  journalMode?: string;
}

interface SnapshotCoverage {
  rows: boolean;
  schema: boolean;
}

interface PostgresScratch {
  databaseName: string;
  owner: string;
  databaseUrl: string;
  adminUrl: string;
}

const FULL_COVERAGE: SnapshotCoverage = { rows: true, schema: true };
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

function stableJson(value: unknown): string {
  if (value === null) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Buffer.isBuffer(value)) return JSON.stringify(`binary:${value.toString('base64')}`);
  if (typeof value === 'bigint') return JSON.stringify(`bigint:${value.toString()}`);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalValue(value: unknown): string {
  if (value === null) return 'null';
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (Buffer.isBuffer(value)) return `binary:${value.toString('base64')}`;
  if (typeof value === 'bigint') return `bigint:${value.toString()}`;
  if (typeof value === 'object') return `json:${stableJson(value)}`;
  return `${typeof value}:${String(value)}`;
}

function canonicalRows(rows: Record<string, unknown>[]): string[] {
  return rows
    .map((row) =>
      stableJson(
        Object.fromEntries(
          Object.entries(row)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, value]) => [key, canonicalValue(value)]),
        ),
      ),
    )
    .sort();
}

function userTableNames(tableNames: string[]): string[] {
  // PostgreSQL queries only public objects; `_migrations` is marker state and `sqlite_%` tables are engine internals.
  return tableNames.filter((name) => name !== '_migrations' && !name.startsWith('sqlite_'));
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

function createScratchDescriptor(databaseName: string): PostgresScratch {
  const databaseUrl = new URL(DATABASE_URL!);
  const adminUrl = new URL(databaseUrl);
  const owner = decodeURIComponent(databaseUrl.username) || 'current_user';
  databaseUrl.pathname = `/${databaseName}`;
  adminUrl.pathname = '/postgres';
  return {
    databaseName,
    owner,
    databaseUrl: databaseUrl.toString(),
    adminUrl: adminUrl.toString(),
  };
}

async function createScratchDatabase(
  scratch: PostgresScratch,
  closeAdmin: (admin: ReturnType<typeof postgres>) => Promise<void> = (admin) =>
    admin.end({ timeout: 5 }),
): Promise<void> {
  const admin = postgres(scratch.adminUrl, { max: 1 });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${quoteIdentifier(scratch.databaseName)}`);
    const owner = scratch.owner === 'current_user' ? '' : ` OWNER ${quoteIdentifier(scratch.owner)}`;
    await admin.unsafe(`CREATE DATABASE ${quoteIdentifier(scratch.databaseName)}${owner}`);
  } finally {
    await closeAdmin(admin);
  }
}

async function dropScratchDatabase(scratch: PostgresScratch): Promise<void> {
  const admin = postgres(scratch.adminUrl, { max: 1 });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${quoteIdentifier(scratch.databaseName)}`);
  } finally {
    await admin.end({ timeout: 5 });
  }
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

async function captureRows(db: Db, tables: string[]): Promise<Record<string, string[]>> {
  const rows: Record<string, string[]> = {};
  for (const table of tables) {
    const qualified = db.dialect === 'postgres' ? `"public".${quoteIdentifier(table)}` : quoteIdentifier(table);
    rows[table] = canonicalRows(await db.all<Record<string, unknown>>(sql.raw(`SELECT * FROM ${qualified}`)));
  }
  return rows;
}

async function sqliteSnapshot(db: Db): Promise<Snapshot> {
  const tableDefinitions = await db.all<{ name: string; sql: string | null }>(
    sql.raw(
      `SELECT name, sql
       FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    ),
  );
  const tables = tableDefinitions.map((row) => row.name);
  const userTables = userTableNames(tables);
  const columns: Record<string, string[]> = {};
  const constraints: Record<string, string[]> = {};

  for (const table of userTables) {
    const quoted = quoteIdentifier(table);
    const tableInfo = await db.all<Record<string, unknown>>(sql.raw(`PRAGMA table_info(${quoted})`));
    const foreignKeys = await db.all<Record<string, unknown>>(sql.raw(`PRAGMA foreign_key_list(${quoted})`));
    const indexList = await db.all<Record<string, unknown>>(sql.raw(`PRAGMA index_list(${quoted})`));
    const tableSql = tableDefinitions.find((row) => row.name === table)?.sql ?? '';
    columns[table] = canonicalRows(tableInfo);
    constraints[table] = [
      `table-sql:${tableSql}`,
      ...canonicalRows(foreignKeys).map((row) => `foreign-key:${row}`),
      ...canonicalRows(
        indexList.filter((row) => Number((row as { unique?: unknown }).unique) === 1),
      ).map((row) => `unique-index:${row}`),
    ].sort();
  }

  const indexes = canonicalRows(
    await db.all<Record<string, unknown>>(
      sql.raw(
        `SELECT name, tbl_name, sql
         FROM sqlite_master
        WHERE type = 'index'
         ORDER BY name`,
      ),
    ),
  );
  const triggers = canonicalRows(
    await db.all<Record<string, unknown>>(
      sql.raw(`SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name`),
    ),
  );
  const migrations = await db.all<{ name: string }>(sql.raw(`SELECT name FROM _migrations ORDER BY name`));
  const userVersion = await db.get<{ user_version: number }>(sql.raw(`PRAGMA user_version`));
  const applicationId = await db.get<{ application_id: number }>(sql.raw(`PRAGMA application_id`));
  const journalMode = await db.get<{ journal_mode: string }>(sql.raw(`PRAGMA journal_mode`));

  return {
    tables,
    rows: await captureRows(db, userTables),
    columns,
    indexes,
    triggers,
    constraints,
    migrations: migrations.map((row) => row.name),
    userVersion: Number(userVersion?.user_version),
    applicationId: Number(applicationId?.application_id),
    journalMode: journalMode?.journal_mode,
  };
}

async function postgresSnapshot(db: Db): Promise<Snapshot> {
  const tableRows = await db.all<{ table_name: string }>(
    sql.raw(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    ),
  );
  const tables = tableRows.map((row) => row.table_name);
  const userTables = userTableNames(tables);
  const columnRows = await db.all<Record<string, unknown>>(
    sql.raw(
      `SELECT table_name, column_name, ordinal_position, data_type, udt_name,
              is_nullable, column_default, is_identity, is_generated
       FROM information_schema.columns
       WHERE table_schema = 'public'
       ORDER BY table_name, ordinal_position`,
    ),
  );
  const constraintRows = await db.all<Record<string, unknown>>(
    sql.raw(
      `SELECT relation.relname AS table_name, con.conname, con.contype,
              pg_get_constraintdef(con.oid, true) AS definition
       FROM pg_constraint AS con
       JOIN pg_class AS relation ON relation.oid = con.conrelid
       JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public'
         AND con.contype IN ('p', 'u', 'f', 'c')
       ORDER BY relation.relname, con.conname`,
    ),
  );
  const columns: Record<string, string[]> = {};
  const constraints: Record<string, string[]> = {};

  for (const table of userTables) {
    columns[table] = canonicalRows(
      columnRows.filter((row) => row.table_name === table),
    );
    constraints[table] = canonicalRows(
      constraintRows.filter((row) => row.table_name === table),
    );
  }

  const indexes = canonicalRows(
    await db.all<Record<string, unknown>>(
      sql.raw(
        `SELECT tablename AS table_name, indexname, indexdef
         FROM pg_indexes
         WHERE schemaname = 'public'
         ORDER BY tablename, indexname`,
      ),
    ),
  );
  const triggers = canonicalRows(
    await db.all<Record<string, unknown>>(
      sql.raw(
        `SELECT relation.relname AS table_name, trigger.tgname AS trigger_name,
                pg_get_triggerdef(trigger.oid, true) AS definition
         FROM pg_trigger AS trigger
         JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
         JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'public' AND NOT trigger.tgisinternal
         ORDER BY relation.relname, trigger.tgname`,
      ),
    ),
  );
  const migrations = await db.all<{ name: string }>(sql.raw(`SELECT name FROM _migrations ORDER BY name`));

  return {
    tables,
    rows: await captureRows(db, userTables),
    columns,
    indexes,
    triggers,
    constraints,
    migrations: migrations.map((row) => row.name),
  };
}

async function snapshot(db: Db): Promise<Snapshot> {
  return db.dialect === 'sqlite' ? sqliteSnapshot(db) : postgresSnapshot(db);
}

function comparableSnapshot(snapshot: Snapshot, coverage: SnapshotCoverage): object {
  return {
    migrations: snapshot.migrations,
    userVersion: snapshot.userVersion,
    applicationId: snapshot.applicationId,
    journalMode: snapshot.journalMode,
    ...(coverage.rows ? { rows: snapshot.rows } : {}),
    ...(coverage.schema
      ? {
          tables: snapshot.tables,
          columns: snapshot.columns,
          indexes: snapshot.indexes,
          triggers: snapshot.triggers,
          constraints: snapshot.constraints,
        }
      : {}),
  };
}

function corpusStateMatches(
  before: Snapshot,
  after: Snapshot,
  coverage: SnapshotCoverage = FULL_COVERAGE,
): boolean {
  return stableJson(comparableSnapshot(before, coverage)) === stableJson(comparableSnapshot(after, coverage));
}

function assertCorpusAcceptance(before: Snapshot, after: Snapshot): void {
  expect(corpusStateMatches(before, after)).toBe(true);
}

async function installMarkerFailure(db: Db, file: string, suffix: string): Promise<() => Promise<void>> {
  const triggerName = `mc_marker_${suffix}`;
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

  const functionName = `mc_marker_fn_${suffix}`;
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
  const suffix = randomUUID().replaceAll('-', '').slice(0, 18);

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

    const after = await snapshot(db);
    assertCorpusAcceptance(before, after);
    expect(before.migrations).not.toContain(file);
    await expect(migrate(db, root)).resolves.toEqual([file]);
    expect(await snapshot(db).then((state) => state.migrations)).toContain(file);
  } finally {
    await db.close();
  }
}

function partialApplyScript(probeTable: string): string {
  return `END;
    UPDATE ${probeTable} SET value = 'escaped' WHERE id = 1;`;
}

function schemaSideEffectScript(
  dialect: Dialect,
  probeTable: string,
  sideTable: string,
  triggerName: string,
  functionName: string,
): string {
  if (dialect === 'sqlite') {
    return `ALTER TABLE ${probeTable} ADD COLUMN escaped TEXT NOT NULL DEFAULT 'x';
      CREATE TRIGGER ${triggerName} AFTER UPDATE ON ${probeTable} BEGIN SELECT 1; END;
      CREATE TABLE ${sideTable} (
        id INTEGER PRIMARY KEY,
        probe_id INTEGER NOT NULL UNIQUE,
        value TEXT NOT NULL CHECK (length(value) > 0),
        FOREIGN KEY (probe_id) REFERENCES ${probeTable}(id)
      );`;
  }

  return `ALTER TABLE ${probeTable} ADD COLUMN escaped TEXT NOT NULL DEFAULT 'x';
    CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $partial$
    BEGIN
      RETURN NEW;
    END;
    $partial$;
    CREATE TRIGGER ${triggerName} BEFORE UPDATE ON ${probeTable}
      FOR EACH ROW EXECUTE FUNCTION ${functionName}();
    CREATE TABLE ${sideTable} (
      id INTEGER PRIMARY KEY,
      probe_id INTEGER NOT NULL UNIQUE REFERENCES ${probeTable}(id),
      value TEXT NOT NULL CHECK (length(value) > 0)
    );`;
}

async function assertPartialApplyDanger(): Promise<void> {
  const db = await createContractDb();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 14);
  const file = `0001_partial_apply_${suffix}.sql`;
  const probeTable = `mc_probe_${suffix}`;
  const root = join(TEST_ARTIFACT_ROOT, randomUUID());
  const directory = join(root, ACTIVE_DIALECT);

  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, file), partialApplyScript(probeTable));

  try {
    expect(await trackingTableExists(db)).toBe(false);
    await createTrackingTable(db);
    await db.execRaw(
      `CREATE TABLE ${probeTable} (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
       INSERT INTO ${probeTable} (id, value) VALUES (1, 'before');`,
    );
    const before = await snapshot(db);

    const removeMarkerFailure = await installMarkerFailure(db, file, suffix);
    try {
      await expect(migrate(db, root)).rejects.toThrow('migration contract marker failure');
    } finally {
      await removeMarkerFailure();
    }
    const after = await snapshot(db);

    expect(after.migrations).not.toContain(file);
    expect(corpusStateMatches(before, after, { rows: false, schema: false })).toBe(true);
    expect(corpusStateMatches(before, after)).toBe(false);
    expect(() => assertCorpusAcceptance(before, after)).toThrow();
    expect(after.rows).not.toEqual(before.rows);
    expect(after.columns).toEqual(before.columns);
    expect(after.indexes).toEqual(before.indexes);
    expect(after.triggers).toEqual(before.triggers);
    expect(after.constraints).toEqual(before.constraints);
  } finally {
    await db.close();
  }
}

async function assertSchemaSnapshotCategories(): Promise<void> {
  const db = await createContractDb();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 14);
  const probeTable = `mc_schema_probe_${suffix}`;
  const sideTable = `mc_schema_side_${suffix}`;
  const triggerName = `mc_schema_trigger_${suffix}`;
  const functionName = `mc_schema_fn_${suffix}`;

  try {
    expect(await trackingTableExists(db)).toBe(false);
    await createTrackingTable(db);
    await db.execRaw(
      `CREATE TABLE ${probeTable} (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
       INSERT INTO ${probeTable} (id, value) VALUES (1, 'before');`,
    );
    const before = await snapshot(db);

    await db.execRaw(
      schemaSideEffectScript(ACTIVE_DIALECT, probeTable, sideTable, triggerName, functionName),
    );
    const after = await snapshot(db);

    expect(corpusStateMatches(before, after, { rows: false, schema: false })).toBe(true);
    expect(corpusStateMatches(before, after)).toBe(false);
    expect(() => assertCorpusAcceptance(before, after)).toThrow();
    expect(after.columns).not.toEqual(before.columns);
    expect(after.indexes).not.toEqual(before.indexes);
    expect(after.triggers).not.toEqual(before.triggers);
    expect(after.constraints).not.toEqual(before.constraints);
  } finally {
    await db.close();
  }
}

async function assertScriptErrorDoesNotRecoverFromLaterMarker(): Promise<void> {
  const db = await createContractDb();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 18);
  const file = `0001_script_failure_${suffix}.sql`;
  const tableName = `mc_script_${suffix}`;
  const auditTableName = `mc_script_audit_${suffix}`;
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
    const before = await snapshot(db);
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
    assertCorpusAcceptance(before, await snapshot(db));
  } finally {
    await db.close();
  }
}

async function assertPostgresMarkerContention(): Promise<void> {
  if (ACTIVE_DIALECT !== 'postgres') return;

  const db = await createContractDb();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 18);
  const contentionFile = `0001_contention_${suffix}.sql`;
  const peerFile = `0001_peer_${suffix}.sql`;
  const tableName = `mc_peer_${suffix}`;
  const root = join(TEST_ARTIFACT_ROOT, randomUUID());
  const directory = join(root, 'postgres');
  const sessionA = postgres(postgresScratch!.databaseUrl, { max: 1 });
  const sessionB = postgres(postgresScratch!.databaseUrl, { max: 1 });

  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, peerFile),
    `CREATE TABLE ${tableName} (id INTEGER PRIMARY KEY);`,
  );

  try {
    expect(await trackingTableExists(db)).toBe(false);
    await createTrackingTable(db);
    await expect(migrate(db, createRoot(ACTIVE_DIALECT, [ACTIVE_FILES[0]!]))).resolves.toEqual([
      ACTIVE_FILES[0],
    ]);
    const inserts = await Promise.allSettled([
      sessionA.unsafe(
        `INSERT INTO _migrations (name, applied_at) VALUES (${quoteLiteral(contentionFile)}, ${Date.now()})`,
      ),
      sessionB.unsafe(
        `INSERT INTO _migrations (name, applied_at) VALUES (${quoteLiteral(contentionFile)}, ${Date.now()})`,
      ),
    ]);
    const conflict = inserts.find((result) => result.status === 'rejected');
    expect(inserts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(conflict?.status).toBe('rejected');
    if (conflict?.status === 'rejected') {
      const error = conflict.reason as Record<string, unknown>;
      expect(error.code).toBe('23505');
      expect(
        error.table === '_migrations' ||
          error.table_name === '_migrations' ||
          error.constraint === '_migrations_pkey',
      ).toBe(true);
    }

    await db.run(sql`INSERT INTO _migrations (name, applied_at) VALUES (${peerFile}, ${Date.now()})`);
    let hideOuterProbe = true;
    let transactionExecuteCount = 0;
    const realDrizzle = db.pg!.drizzle;
    const hiddenMarkerDrizzle = new Proxy(realDrizzle, {
      get(target, property) {
        if (property === 'transaction') {
          return async <T>(callback: (tx: Record<string, unknown>) => Promise<T>): Promise<T> =>
            target.transaction(async (tx) => {
              const hiddenMarkerTx = new Proxy(tx, {
                get(transaction, transactionProperty) {
                  if (transactionProperty === 'execute') {
                    return async (query: unknown): Promise<unknown> => {
                      transactionExecuteCount++;
                      if (transactionExecuteCount === 2) return [];
                      return (transaction.execute as (statement: unknown) => Promise<unknown>)(query);
                    };
                  }
                  const value = Reflect.get(transaction, transactionProperty, transaction);
                  return typeof value === 'function' ? value.bind(transaction) : value;
                },
              });
              return callback(hiddenMarkerTx);
            });
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as typeof realDrizzle;
    const peerAppliedDb: Db = {
      ...db,
      get: async <T>(query) => {
        if (hideOuterProbe) {
          hideOuterProbe = false;
          return undefined;
        }
        return db.get<T>(query);
      },
      pg: { ...db.pg!, drizzle: hiddenMarkerDrizzle },
    };

    await expect(migrate(peerAppliedDb, root)).resolves.toEqual([]);
    expect(await snapshot(db).then((state) => state.migrations)).toContain(peerFile);
    expect(await snapshot(db).then((state) => state.tables)).not.toContain(tableName);
  } finally {
    await sessionA.end({ timeout: 5 });
    await sessionB.end({ timeout: 5 });
    await db.close();
  }
}

beforeAll(async () => {
  if (POSTGRES_REQUIRED && !POSTGRES_CONFIGURED) {
    throw new Error('MIGRATION_CONTRACT_POSTGRES_REQUIRED requires a PostgreSQL DATABASE_URL');
  }
  if (!POSTGRES_CONFIGURED) return;

  postgresScratch = createScratchDescriptor(
    `migration_contract_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
  );
  await createScratchDatabase(postgresScratch);
});

afterAll(async () => {
  try {
    if (postgresScratch) await dropScratchDatabase(postgresScratch);
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

  it('explicitly records when the PostgreSQL contract lane is skipped', () => {
    if (POSTGRES_CONFIGURED) return;
    expect(POSTGRES_REQUIRED).toBe(false);
    console.info(
      'PostgreSQL migration contract skipped: dedicated PostgreSQL CI lanes carry this safety proof.',
    );
  });

  for (const [index, file] of ACTIVE_FILES.entries()) {
    it(`rolls back ${file} with its marker`, async () => {
      await assertRollbackForFile(file, index);
    });
  }

  it('rejects the one DML-only partial-apply fixture and kills the row/schema counterfactual', async () => {
    await assertPartialApplyDanger();
  });

  it('recognizes column, index, trigger, and constraint side effects', async () => {
    await assertSchemaSnapshotCategories();
  });

  it('propagates script failures without a later marker recovery probe', async () => {
    await assertScriptErrorDoesNotRecoverFromLaterMarker();
  });

  it('verifies PostgreSQL marker contention metadata and peer recognition', async () => {
    await assertPostgresMarkerContention();
  });

  it('drops a recorded scratch database after a simulated admin close failure', async () => {
    if (ACTIVE_DIALECT !== 'postgres') return;

    const scratch = createScratchDescriptor(
      `migration_cleanup_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
    );
    await expect(
      createScratchDatabase(scratch, async (admin) => {
        await admin.end({ timeout: 5 });
        throw new Error('simulated admin close failure');
      }),
    ).rejects.toThrow('simulated admin close failure');
    await dropScratchDatabase(scratch);

    const admin = postgres(scratch.adminUrl, { max: 1 });
    try {
      const rows = await admin.unsafe(
        `SELECT datname FROM pg_database WHERE datname = ${quoteLiteral(scratch.databaseName)}`,
      );
      expect(rows).toHaveLength(0);
    } finally {
      await admin.end({ timeout: 5 });
    }
  });
});
