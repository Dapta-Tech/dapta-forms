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

const UNSAFE_MIGRATION_STATEMENT =
  /(?:^|;)\s*(BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|SET\s+TRANSACTION|PREPARE\s+TRANSACTION|END\s+TRANSACTION|ABORT|VACUUM|PRAGMA|CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY)\b/i;

function maskSqlCommentsAndQuotedText(script: string): string {
  let masked = '';

  for (let index = 0; index < script.length; ) {
    const current = script[index]!;
    const next = script[index + 1];

    if (current === '-' && next === '-') {
      const end = script.indexOf('\n', index);
      const comment = script.slice(index, end === -1 ? script.length : end);
      masked += comment.replace(/[^\r\n]/g, ' ');
      index += comment.length;
      continue;
    }

    if (current === '/' && next === '*') {
      let depth = 1;
      let end = index + 2;
      while (depth > 0 && end < script.length) {
        if (script[end] === '/' && script[end + 1] === '*') {
          depth++;
          end += 2;
        } else if (script[end] === '*' && script[end + 1] === '/') {
          depth--;
          end += 2;
        } else {
          end++;
        }
      }
      const comment = script.slice(index, end);
      masked += comment.replace(/[^\r\n]/g, ' ');
      index = end;
      continue;
    }

    if (current === "'" || current === '"' || current === '`' || current === '[') {
      const closing = current === '[' ? ']' : current;
      let end = index + 1;
      while (end < script.length) {
        if (script[end] === closing) {
          if (script[end + 1] === closing) {
            end += 2;
            continue;
          }
          end++;
          break;
        }
        if (current === "'" && script[end] === '\\' && end + 1 < script.length) {
          end += 2;
        } else {
          end++;
        }
      }
      const quoted = script.slice(index, end);
      masked += quoted.replace(/[^\r\n]/g, ' ');
      index = end;
      continue;
    }

    if (current === '$') {
      const delimiter = script.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (delimiter) {
        const closing = script.indexOf(delimiter, index + delimiter.length);
        if (closing !== -1) {
          const quoted = script.slice(index, closing + delimiter.length);
          masked += quoted.replace(/[^\r\n]/g, ' ');
          index += quoted.length;
          continue;
        }
      }
    }

    masked += current;
    index++;
  }

  return masked;
}

function assertSafeMigrationScript(file: string, script: string): void {
  const unsafeStatement = maskSqlCommentsAndQuotedText(script).match(UNSAFE_MIGRATION_STATEMENT)?.[1];
  if (!unsafeStatement) return;

  throw new Error(
    `Unsafe migration statement in ${file}: ${unsafeStatement.replace(/\s+/g, ' ').toUpperCase()}. ` +
      'Migration scripts cannot control transactions, run VACUUM or PRAGMA, or create indexes concurrently.',
  );
}

function migrationMarkerSql(file: string): string {
  const escapedFile = file.replaceAll("'", "''");
  return `INSERT INTO _migrations (name, applied_at) VALUES ('${escapedFile}', ${Date.now()})`;
}

async function applyMigrationAtomically(db: Db, file: string, script: string): Promise<void> {
  if (db.dialect === 'sqlite') {
    const sqlite = db.sqlite;
    if (!sqlite) throw new Error('SQLite migrations require the native SQLite handle');
    sqlite.txn(() => {
      sqlite.exec(script);
      sqlite.exec(migrationMarkerSql(file));
    });
    return;
  }

  if (!db.pg) throw new Error('Postgres migrations require the native Postgres handle');
  await db.pg.drizzle.transaction(async (tx) => {
    await tx.execute(sql.raw(script));
    await tx.execute(sql`INSERT INTO _migrations (name, applied_at) VALUES (${file}, ${Date.now()})`);
  });
}

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
    assertSafeMigrationScript(file, script);

    try {
      await applyMigrationAtomically(db, file, script);
      applied.push(file);
    } catch (error) {
      const appliedByPeer = await db.get<{ name: string }>(
        sql`SELECT name FROM _migrations WHERE name = ${file} LIMIT 1`,
      );
      if (!appliedByPeer) throw error;
    }
  }

  // Data fixups that portable SQL can't express (random short-code generation,
  // handle derivation). Idempotent + cheap no-ops once applied, so they run
  // unconditionally after the SQL migrations on both dialects.
  await applyShortLinkFixups(db);

  return applied;
}
