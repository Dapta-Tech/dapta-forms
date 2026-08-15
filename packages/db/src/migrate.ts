/**
 * A tiny, dialect-agnostic forward migrator. Reads the numbered .sql files in
 * migrations/<dialect>/ in filename order and applies each once, tracking
 * applied names in a `_migrations` table. Identical semantics on SQLite and
 * Postgres — no drizzle-kit / engine binary needed for clone-and-run.
 */
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { applyShortLinkFixups } from './short-links';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = join(HERE, '..', 'migrations');
const SQLITE_LOCK_RETRIES = 20;
const SQLITE_LOCK_RETRY_DELAY_MS = 10;

class MarkerInsertFailure extends Error {
  constructor(readonly original: unknown) {
    super('Migration marker insert failed');
  }
}

class MigrationEscapeError extends Error {
  readonly file: string;
  readonly dialect: Db['dialect'];
  override readonly cause: unknown;

  constructor(
    file: string,
    dialect: Db['dialect'],
    cause: unknown,
  ) {
    super(
      `Migration ${file} escaped the ${dialect} transaction boundary; marker withheld and no recovery attempted because effects may already be durable.`,
    );
    this.name = 'MigrationEscapeError';
    this.file = file;
    this.dialect = dialect;
    this.cause = cause;
  }
}

function canarySavepointName(): string {
  return `migration_canary_${randomBytes(16).toString('hex')}`;
}

function migrationMarkerSql(file: string): string {
  const escapedFile = file.replaceAll("'", "''");
  return `INSERT INTO _migrations (name, applied_at) VALUES ('${escapedFile}', ${Date.now()})`;
}

function errorField(error: unknown, field: string): unknown {
  if (typeof error !== 'object' || error === null || !(field in error)) return undefined;
  return (error as Record<string, unknown>)[field];
}

function isSqliteBusyOrLocked(error: unknown): boolean {
  const code = errorField(error, 'code');
  return (
    typeof code === 'string' &&
    (code === 'SQLITE_BUSY' ||
      code === 'SQLITE_LOCKED' ||
      code.startsWith('SQLITE_BUSY_') ||
      code.startsWith('SQLITE_LOCKED_'))
  );
}

function isExactMarkerUniqueConflict(db: Db, error: unknown): boolean {
  if (db.dialect === 'postgres') {
    return (
      errorField(error, 'code') === '23505' &&
      (errorField(error, 'table') === '_migrations' ||
        errorField(error, 'table_name') === '_migrations' ||
        errorField(error, 'constraint') === '_migrations_pkey')
    );
  }

  const code = errorField(error, 'code');
  const message = errorField(error, 'message');
  return (
    (code === 'SQLITE_CONSTRAINT' ||
      code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
      code === 'SQLITE_CONSTRAINT_UNIQUE') &&
    typeof message === 'string' &&
    (message.includes('UNIQUE constraint failed: _migrations.name') ||
      message.includes('PRIMARY KEY must be unique: _migrations.name'))
  );
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function migrationAlreadyApplied(db: Db, file: string): Promise<boolean> {
  return Boolean(
    await db.get<{ name: string }>(sql`SELECT name FROM _migrations WHERE name = ${file} LIMIT 1`),
  );
}

async function applyMigrationAtomically(db: Db, file: string, script: string): Promise<boolean> {
  if (db.dialect === 'sqlite') {
    const sqlite = db.sqlite;
    if (!sqlite) throw new Error('SQLite migrations require the native SQLite handle');

    return sqlite.txn(() => {
      const already = sqlite.drizzle.get<{ name: string }>(
        sql`SELECT name FROM _migrations WHERE name = ${file} LIMIT 1`,
      );
      if (already) return false;

      const canary = canarySavepointName();
      sqlite.exec(`SAVEPOINT ${canary}`);
      sqlite.exec(script);
      try {
        sqlite.exec(`RELEASE SAVEPOINT ${canary}`);
      } catch (error) {
        throw new MigrationEscapeError(file, db.dialect, error);
      }
      try {
        sqlite.exec(migrationMarkerSql(file));
      } catch (error) {
        throw new MarkerInsertFailure(error);
      }
      return true;
    });
  }

  if (!db.pg) throw new Error('Postgres migrations require the native Postgres handle');
  return db.pg.drizzle.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE _migrations IN SHARE ROW EXCLUSIVE MODE`);
    const already = await tx.execute(
      sql`SELECT name FROM _migrations WHERE name = ${file} LIMIT 1`,
    );
    if (already.length > 0) return false;

    const canary = canarySavepointName();
    await tx.execute(sql.raw(`SAVEPOINT ${canary}`));
    await tx.execute(sql.raw(script));
    try {
      await tx.execute(sql.raw(`RELEASE SAVEPOINT ${canary}`));
    } catch (error) {
      throw new MigrationEscapeError(file, db.dialect, error);
    }
    try {
      await tx.execute(
        sql`INSERT INTO _migrations (name, applied_at) VALUES (${file}, ${Date.now()})`,
      );
    } catch (error) {
      throw new MarkerInsertFailure(error);
    }
    return true;
  });
}

async function applyMigrationOrObservePeer(db: Db, file: string, script: string): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await applyMigrationAtomically(db, file, script);
    } catch (caught) {
      if (caught instanceof MigrationEscapeError) throw caught;
      const original = caught instanceof MarkerInsertFailure ? caught.original : caught;
      if (
        db.dialect === 'sqlite' &&
        isSqliteBusyOrLocked(original) &&
        attempt < SQLITE_LOCK_RETRIES
      ) {
        await pause(SQLITE_LOCK_RETRY_DELAY_MS);
        continue;
      }
      if (caught instanceof MarkerInsertFailure && isExactMarkerUniqueConflict(db, original)) {
        try {
          if (await migrationAlreadyApplied(db, file)) return false;
        } catch {
          throw original;
        }
      }
      throw original;
    }
  }
}

export async function migrate(db: Db, migrationsRoot = MIGRATIONS_ROOT): Promise<string[]> {
  const dir = join(migrationsRoot, db.dialect);
  await db.execRaw(
    `CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)`,
  );
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const applied: string[] = [];
  for (const file of files) {
    if (await migrationAlreadyApplied(db, file)) continue;

    const script = readFileSync(join(dir, file), 'utf8');
    if (await applyMigrationOrObservePeer(db, file, script)) {
      applied.push(file);
    }
  }

  // These run after every migration pass and are outside per-file script+marker atomicity.
  await applyShortLinkFixups(db);

  return applied;
}
