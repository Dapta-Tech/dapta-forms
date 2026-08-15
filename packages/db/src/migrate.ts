import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { applyShortLinkFixups } from './short-links';

const MIGRATIONS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const SQLITE_LOCK_RETRIES = 20;
const SQLITE_LOCK_RETRY_DELAY_MS = 10;

class MarkerInsertFailure {
  constructor(readonly original: unknown) {}
}

type DriverError = {
  code?: unknown;
  message?: unknown;
  table?: unknown;
  table_name?: unknown;
  constraint?: unknown;
};

function details(error: unknown): DriverError {
  return (error ?? {}) as DriverError;
}

function markerSql(file: string): string {
  return `INSERT INTO _migrations (name, applied_at) VALUES ('${file.replaceAll("'", "''")}', ${Date.now()})`;
}

function isBusyOrLocked(error: unknown): boolean {
  const { code } = details(error);
  return (
    typeof code === 'string' &&
    (code === 'SQLITE_BUSY' ||
      code === 'SQLITE_LOCKED' ||
      code.startsWith('SQLITE_BUSY_') ||
      code.startsWith('SQLITE_LOCKED_'))
  );
}

function isMarkerUniqueConflict(db: Db, error: unknown): boolean {
  const issue = details(error);
  if (db.dialect === 'postgres') {
    return (
      issue.code === '23505' &&
      (issue.table === '_migrations' ||
        issue.table_name === '_migrations' ||
        issue.constraint === '_migrations_pkey')
    );
  }
  return (
    (issue.code === 'SQLITE_CONSTRAINT' ||
      issue.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
      issue.code === 'SQLITE_CONSTRAINT_UNIQUE') &&
    typeof issue.message === 'string' &&
    (issue.message.includes('UNIQUE constraint failed: _migrations.name') ||
      issue.message.includes('PRIMARY KEY must be unique: _migrations.name'))
  );
}

async function isApplied(db: Db, file: string): Promise<boolean> {
  return Boolean(
    await db.get<{ name: string }>(sql`SELECT name FROM _migrations WHERE name = ${file} LIMIT 1`),
  );
}

async function applyAtomically(db: Db, file: string, script: string): Promise<boolean> {
  if (db.dialect === 'sqlite') {
    const sqlite = db.sqlite;
    if (!sqlite) throw new Error('SQLite migrations require the native SQLite handle');
    return sqlite.txn(() => {
      sqlite.exec(script);
      try {
        sqlite.exec(markerSql(file));
      } catch (error) {
        throw new MarkerInsertFailure(error);
      }
      return true;
    });
  }

  if (!db.pg) throw new Error('Postgres migrations require the native Postgres handle');
  return db.pg.drizzle.transaction(async (tx) => {
    await tx.execute(sql.raw(script));
    try {
      await tx.execute(sql`INSERT INTO _migrations (name, applied_at) VALUES (${file}, ${Date.now()})`);
    } catch (error) {
      throw new MarkerInsertFailure(error);
    }
    return true;
  });
}

async function applyOrObservePeer(db: Db, file: string, script: string): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await applyAtomically(db, file, script);
    } catch (caught) {
      const original = caught instanceof MarkerInsertFailure ? caught.original : caught;
      if (db.dialect === 'sqlite' && isBusyOrLocked(original) && attempt < SQLITE_LOCK_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, SQLITE_LOCK_RETRY_DELAY_MS));
        continue;
      }
      if (caught instanceof MarkerInsertFailure && isMarkerUniqueConflict(db, original)) {
        try {
          if (await isApplied(db, file)) return false;
        } catch {
          throw original;
        }
      }
      throw original;
    }
  }
}

export async function migrate(db: Db, migrationsRoot = MIGRATIONS_ROOT): Promise<string[]> {
  const directory = join(migrationsRoot, db.dialect);
  await db.execRaw(
    `CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)`,
  );
  const applied: string[] = [];
  for (const file of readdirSync(directory).filter((file) => file.endsWith('.sql')).sort()) {
    if (await isApplied(db, file)) continue;
    if (await applyOrObservePeer(db, file, readFileSync(join(directory, file), 'utf8'))) {
      applied.push(file);
    }
  }
  await applyShortLinkFixups(db);
  return applied;
}
