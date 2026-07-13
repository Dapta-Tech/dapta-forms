/**
 * createDb(DATABASE_URL) — the one factory that selects the dialect.
 *   unset / "file:…"  -> SQLite (better-sqlite3), the zero-infra default
 *   "postgres://…"    -> Postgres (postgres-js)
 *
 * Returns a small dialect-agnostic `Db` handle. Reads/writes go through
 * `all/get/run` (portable Drizzle `sql` templates). Native handles (`sqlite.txn`,
 * `pg.drizzle`) stay available for operations that legitimately need each
 * engine's own primitives.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { sql, type SQL } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { isPostgresUrl } from '@quill/config/env';

export type Dialect = 'sqlite' | 'postgres';

/** Native SQLite handles for the synchronous atomic path. */
export interface SqliteNative {
  drizzle: BetterSQLite3Database;
  /** better-sqlite3 Database — used for its synchronous `.transaction()`. */
  txn: <T>(fn: () => T) => T;
}

/** Native Postgres handle for the async atomic path. */
export interface PgNative {
  drizzle: PostgresJsDatabase;
}

export interface Db {
  readonly dialect: Dialect;
  all<T = Record<string, unknown>>(query: SQL): Promise<T[]>;
  get<T = Record<string, unknown>>(query: SQL): Promise<T | undefined>;
  run(query: SQL): Promise<void>;
  /** Execute a raw multi-statement SQL script (migrations only; no params). */
  execRaw(sqlText: string): Promise<void>;
  /** Present only when dialect === 'sqlite'. */
  sqlite?: SqliteNative;
  /** Present only when dialect === 'postgres'. */
  pg?: PgNative;
  close(): Promise<void>;
}

export { sql };

/**
 * Find the monorepo root by walking up for pnpm-workspace.yaml. A relative
 * default SQLite path must resolve to the SAME file no matter which package's
 * cwd invoked it (the API, the migrate CLI, and the web app all differ), so we
 * anchor it here rather than at process.cwd().
 */
function findWorkspaceRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 20; i++) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

/**
 * Resolve the SQLite filesystem path (":memory:" passes through). A relative
 * `file:` path is anchored to the workspace root so every process shares one DB.
 */
export function sqlitePathFromUrl(url: string): string {
  if (!url || url === 'file::memory:' || url === ':memory:') return ':memory:';
  const raw = url.startsWith('file:') ? url.slice('file:'.length) : url;
  if (isAbsolute(raw)) return raw;
  return resolve(findWorkspaceRoot(process.cwd()), raw);
}

export async function createDb(
  databaseUrl = process.env.DATABASE_URL ?? 'file:./.data/dev.db',
): Promise<Db> {
  if (isPostgresUrl(databaseUrl)) {
    return createPostgresDb(databaseUrl);
  }
  return createSqliteDb(databaseUrl);
}

// --- SQLite ---------------------------------------------------------------

async function createSqliteDb(url: string): Promise<Db> {
  const { default: Database } = await import('better-sqlite3');
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const path = sqlitePathFromUrl(url);
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite);

  return {
    dialect: 'sqlite',
    all: <T>(query: SQL) => Promise.resolve(db.all(query) as T[]),
    get: <T>(query: SQL) => Promise.resolve(db.get(query) as T | undefined),
    run: (query: SQL) => {
      db.run(query);
      return Promise.resolve();
    },
    execRaw: (sqlText: string) => {
      sqlite.exec(sqlText);
      return Promise.resolve();
    },
    sqlite: {
      drizzle: db,
      txn: <T>(fn: () => T): T => sqlite.transaction(fn)(),
    },
    close: () => {
      sqlite.close();
      return Promise.resolve();
    },
  };
}

// --- Postgres -------------------------------------------------------------

async function createPostgresDb(url: string): Promise<Db> {
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const client = postgres(url, { max: 10 });
  const db = drizzle(client);

  return {
    dialect: 'postgres',
    all: async <T>(query: SQL) => (await db.execute(query)) as unknown as T[],
    get: async <T>(query: SQL) => {
      const rows = (await db.execute(query)) as unknown as T[];
      return rows[0];
    },
    run: async (query: SQL) => {
      await db.execute(query);
    },
    execRaw: async (sqlText: string) => {
      await client.unsafe(sqlText);
    },
    pg: { drizzle: db },
    close: async () => {
      await client.end({ timeout: 5 });
    },
  };
}
