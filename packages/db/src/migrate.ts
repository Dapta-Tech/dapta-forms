/**
 * A tiny, dialect-agnostic forward migrator. Reads the numbered .sql files in
 * migrations/<dialect>/ in filename order and applies each once, tracking
 * applied names in a `_migrations` table. Identical semantics on SQLite and
 * Postgres, with no drizzle-kit or engine binary needed for clone-and-run.
 *
 * Each file and its `_migrations` marker are applied inside the driver's own
 * transaction, so a file that throws leaves neither its statements nor its
 * marker behind. A fork whose migration drives its own transaction, or uses a
 * statement that cannot run inside one, opts out of that and may partially
 * apply. Nothing detects it; see SELF-HOSTING.md.
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
 * The SQLite marker INSERT as one literal statement.
 *
 * The only unparameterized write in the migrator, and it has to be: the marker
 * is written with `sqlite.exec` inside the same `sqlite.txn` as the migration
 * file, so the two commit together, and `exec` takes SQL text with nowhere to
 * bind a parameter. The Postgres path a few lines below binds normally. `file`
 * is a filename read off the repo's own migrations directory, never user input,
 * and the quote doubling is what keeps it a literal regardless.
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
  await applyShortLinkFixups(db);
  return applied;
}
