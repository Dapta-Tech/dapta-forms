/**
 * A tiny, dialect-agnostic forward migrator. Reads the numbered .sql files in
 * migrations/<dialect>/ in filename order and applies each once, tracking
 * applied names in a `_migrations` table. Identical semantics on SQLite and
 * Postgres — no drizzle-kit / engine binary needed for clone-and-run.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { applyShortLinkFixups } from './short-links';

const HERE = dirname(fileURLToPath(import.meta.url));
// src/ at runtime (tsx) or dist/ after build — migrations live one level up.
const MIGRATIONS_ROOT = join(HERE, '..', 'migrations');

export async function migrate(db: Db, migrationsRoot = MIGRATIONS_ROOT): Promise<string[]> {
  const dir = join(migrationsRoot, db.dialect);
  await db.execRaw(
    `CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)`,
  );
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied: string[] = [];
  for (const file of files) {
    const already = await db.get<{ name: string }>(
      sql`SELECT name FROM _migrations WHERE name = ${file} LIMIT 1`,
    );
    if (already) continue;
    const script = readFileSync(join(dir, file), 'utf8');
    await db.execRaw(script);
    await db.run(sql`INSERT INTO _migrations (name, applied_at) VALUES (${file}, ${Date.now()})`);
    applied.push(file);
  }

  // Data fixups that portable SQL can't express (random short-code generation,
  // handle derivation). Idempotent + cheap no-ops once applied, so they run
  // unconditionally after the SQL migrations on both dialects.
  await applyShortLinkFixups(db);

  return applied;
}
