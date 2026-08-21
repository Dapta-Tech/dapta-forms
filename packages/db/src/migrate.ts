/**
 * A tiny, dialect-agnostic forward migrator. Reads the numbered .sql files in
 * migrations/<dialect>/ in filename order and applies each once, tracking
 * applied names in a `_migrations` table. Identical semantics on SQLite and
 * Postgres, with no drizzle-kit / engine binary needed for clone-and-run.
 *
 * A script and its `_migrations` marker commit in ONE native transaction, so a
 * failure can never leave the schema changed with no record of it: SQLite uses
 * better-sqlite3's synchronous `transaction()`, Postgres its own. When the
 * whole attempt rolls back, `applyOrObservePeer` re-reads the marker before
 * reporting failure, which is how a concurrent runner that won the race is told
 * apart from a migration that is genuinely broken.
 *
 * The transaction is also the boundary: a migration that cannot run inside one
 * (CREATE INDEX CONCURRENTLY, VACUUM) is unsupported here. None of the shipped
 * scripts need that, and SELF-HOSTING.md documents it for forks.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { applyShortLinkFixups } from './short-links';

// src/ at runtime (tsx) or dist/ after build: migrations live one level up.
const MIGRATIONS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const SQLITE_LOCK_RETRIES = 20;
const SQLITE_LOCK_RETRY_DELAY_MS = 10;

type DriverError = {
  code?: unknown;
};

function details(error: unknown): DriverError {
  return (error ?? {}) as DriverError;
}

/**
 * The marker INSERT as raw text, for the SQLite path only.
 *
 * Everywhere else in this package the marker is a parameterized statement. Here
 * it cannot be: the script and its marker must commit inside better-sqlite3's
 * synchronous `transaction()`, and the only way in is `exec()`, which takes a
 * SQL string and no bindings. `file` is a filename this module just read out of
 * `migrations/<dialect>/`, never anything a request supplied, so the quote
 * doubling is belt-and-braces rather than the thing standing between us and an
 * injection. The Postgres path a few lines down stays parameterized.
 */
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
      sqlite.exec(markerSql(file));
      return true;
    });
  }

  if (!db.pg) throw new Error('Postgres migrations require the native Postgres handle');
  return db.pg.drizzle.transaction(async (tx) => {
    await tx.execute(sql.raw(script));
    await tx.execute(sql`INSERT INTO _migrations (name, applied_at) VALUES (${file}, ${Date.now()})`);
    return true;
  });
}

async function applyOrObservePeer(db: Db, file: string, script: string): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await applyAtomically(db, file, script);
    } catch (original) {
      if (db.dialect === 'sqlite' && isBusyOrLocked(original) && attempt < SQLITE_LOCK_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, SQLITE_LOCK_RETRY_DELAY_MS));
        continue;
      }
      try {
        if (await isApplied(db, file)) return false;
      } catch {
        // The original application failure remains authoritative if the peer probe fails.
      }
      throw new Error(`Migration ${file} failed on ${db.dialect}`, { cause: original });
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
  // Data fixups that portable SQL can't express (random short-code generation,
  // handle derivation). Idempotent + cheap no-ops once applied, so they run
  // unconditionally after the SQL migrations on both dialects. Deliberately
  // OUTSIDE the per-script transactions above: they are not migrations and
  // own no marker.
  await applyShortLinkFixups(db);
  return applied;
}
