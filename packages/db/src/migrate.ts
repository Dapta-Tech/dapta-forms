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
const SQLITE_BUSY_MAX_RETRIES = 20;
const SQLITE_BUSY_RETRY_DELAY_MS = 10;

type UnsafeMigrationClassification =
  | 'outer transaction control'
  | 'transaction-incompatible VACUUM'
  | 'unsafe PRAGMA'
  | 'transaction-incompatible CREATE INDEX CONCURRENTLY';

function isAsciiLetter(value: string): boolean {
  return (value >= 'A' && value <= 'Z') || (value >= 'a' && value <= 'z');
}

function isWordStart(value: string): boolean {
  return isAsciiLetter(value) || value === '_';
}

function isWordCharacter(value: string): boolean {
  return isWordStart(value) || (value >= '0' && value <= '9') || value === '$';
}

function scanLineComment(script: string, index: number): number {
  const end = script.indexOf('\n', index + 2);
  return end === -1 ? script.length : end;
}

function scanBlockComment(script: string, index: number, dialect: Db['dialect']): number {
  let cursor = index + 2;
  let depth = 1;

  while (cursor < script.length) {
    if (dialect === 'postgres' && script[cursor] === '/' && script[cursor + 1] === '*') {
      depth++;
      cursor += 2;
      continue;
    }
    if (script[cursor] === '*' && script[cursor + 1] === '/') {
      depth--;
      cursor += 2;
      if (depth === 0) return cursor;
      continue;
    }
    cursor++;
  }

  return cursor;
}

function scanSingleQuoted(script: string, index: number, backslashEscapes: boolean): number {
  let cursor = index + 1;

  while (cursor < script.length) {
    if (script[cursor] === "'") {
      if (script[cursor + 1] === "'") {
        cursor += 2;
        continue;
      }
      return cursor + 1;
    }
    if (backslashEscapes && script[cursor] === '\\' && cursor + 1 < script.length) {
      cursor += 2;
      continue;
    }
    cursor++;
  }

  return cursor;
}

function scanDoubledQuote(script: string, index: number, quote: '"' | '`'): number {
  let cursor = index + 1;

  while (cursor < script.length) {
    if (script[cursor] === quote) {
      if (script[cursor + 1] === quote) {
        cursor += 2;
        continue;
      }
      return cursor + 1;
    }
    cursor++;
  }

  return cursor;
}

function scanBracketQuoted(script: string, index: number): number {
  const end = script.indexOf(']', index + 1);
  return end === -1 ? script.length : end + 1;
}

function postgresDollarQuoteDelimiter(script: string, index: number): string | undefined {
  if (script[index] !== '$') return undefined;
  if (script[index + 1] === '$') return '$$';
  if (!isWordStart(script[index + 1] ?? '')) return undefined;

  let cursor = index + 2;
  while (isWordCharacter(script[cursor] ?? '') && script[cursor] !== '$') cursor++;
  return script[cursor] === '$' ? script.slice(index, cursor + 1) : undefined;
}

function scanDollarQuoted(script: string, index: number, delimiter: string): number {
  const end = script.indexOf(delimiter, index + delimiter.length);
  return end === -1 ? script.length : end + delimiter.length;
}

function isPostgresEscapeString(script: string, index: number): boolean {
  if ((script[index] !== 'E' && script[index] !== 'e') || script[index + 1] !== "'") return false;
  return index === 0 || !isWordCharacter(script[index - 1]!);
}

function isSQLiteTrigger(tokens: string[]): boolean {
  if (tokens[0] !== 'CREATE') return false;
  let index = 1;
  if (tokens[index] === 'TEMP' || tokens[index] === 'TEMPORARY') index++;
  return tokens[index] === 'TRIGGER';
}

function lexStatements(script: string, dialect: Db['dialect']): string[][] {
  const statements: string[][] = [];
  let tokens: string[] = [];
  let index = 0;
  let sqliteTriggerBody = false;
  let sqliteTriggerEnds = false;
  let sqliteCaseDepth = 0;

  const addToken = (token: string): void => {
    tokens.push(token);

    if (dialect !== 'sqlite') return;
    if (!sqliteTriggerBody) {
      if (token === 'BEGIN' && isSQLiteTrigger(tokens)) sqliteTriggerBody = true;
      return;
    }
    if (token === 'CASE') {
      sqliteCaseDepth++;
      sqliteTriggerEnds = false;
      return;
    }
    if (token === 'END') {
      if (sqliteCaseDepth > 0) sqliteCaseDepth--;
      else sqliteTriggerEnds = true;
      return;
    }
    if (sqliteTriggerEnds) sqliteTriggerEnds = false;
  };

  const finishStatement = (): void => {
    if (tokens.length > 0) statements.push(tokens);
    tokens = [];
    sqliteTriggerBody = false;
    sqliteTriggerEnds = false;
    sqliteCaseDepth = 0;
  };

  while (index < script.length) {
    const current = script[index]!;
    const next = script[index + 1];

    if (current === ';') {
      if (!sqliteTriggerBody || sqliteTriggerEnds) finishStatement();
      index++;
      continue;
    }
    if (current === '-' && next === '-') {
      index = scanLineComment(script, index);
      continue;
    }
    if (current === '/' && next === '*') {
      index = scanBlockComment(script, index, dialect);
      continue;
    }
    if (dialect === 'postgres' && isPostgresEscapeString(script, index)) {
      index = scanSingleQuoted(script, index + 1, true);
      continue;
    }
    if (current === "'") {
      index = scanSingleQuoted(script, index, false);
      continue;
    }
    if (current === '"') {
      index = scanDoubledQuote(script, index, '"');
      continue;
    }
    if (dialect === 'sqlite' && current === '`') {
      index = scanDoubledQuote(script, index, '`');
      continue;
    }
    if (dialect === 'sqlite' && current === '[') {
      index = scanBracketQuoted(script, index);
      continue;
    }
    if (dialect === 'postgres' && current === '$') {
      const delimiter = postgresDollarQuoteDelimiter(script, index);
      if (delimiter) {
        index = scanDollarQuoted(script, index, delimiter);
        continue;
      }
    }
    if (isWordStart(current)) {
      let end = index + 1;
      while (isWordCharacter(script[end] ?? '')) end++;
      addToken(script.slice(index, end).toUpperCase());
      index = end;
      continue;
    }
    if (!/\s/.test(current)) addToken(current);
    index++;
  }

  finishStatement();
  return statements;
}

function isRollbackToSavepoint(tokens: string[]): boolean {
  let index = 1;
  if (tokens[index] === 'TRANSACTION' || tokens[index] === 'WORK') index++;
  return tokens[index] === 'TO';
}

function isSafeSqlitePragma(tokens: string[]): boolean {
  if (tokens[1] !== 'DEFER_FOREIGN_KEYS') return false;
  return (
    (tokens.length === 4 && tokens[2] === '=' && tokens[3] === 'ON') ||
    (tokens.length === 5 && tokens[2] === '(' && tokens[3] === 'ON' && tokens[4] === ')')
  );
}

function isCreateIndexConcurrently(tokens: string[]): boolean {
  let index = 1;
  if (tokens[index] === 'UNIQUE') index++;
  return tokens[index] === 'INDEX' && tokens[index + 1] === 'CONCURRENTLY';
}

function classifyStatement(
  dialect: Db['dialect'],
  tokens: string[],
): UnsafeMigrationClassification | undefined {
  const first = tokens[0];
  if (!first) return undefined;

  if (
    first === 'BEGIN' ||
    first === 'COMMIT' ||
    first === 'END' ||
    first === 'ABORT' ||
    (first === 'START' && tokens[1] === 'TRANSACTION') ||
    (first === 'PREPARE' && tokens[1] === 'TRANSACTION') ||
    (first === 'SET' && tokens[1] === 'TRANSACTION')
  ) {
    return 'outer transaction control';
  }
  if (first === 'ROLLBACK' && !isRollbackToSavepoint(tokens)) {
    return 'outer transaction control';
  }
  if (first === 'VACUUM') return 'transaction-incompatible VACUUM';
  if (first === 'PRAGMA' && (dialect !== 'sqlite' || !isSafeSqlitePragma(tokens))) {
    return 'unsafe PRAGMA';
  }
  if (first === 'CREATE' && isCreateIndexConcurrently(tokens)) {
    return 'transaction-incompatible CREATE INDEX CONCURRENTLY';
  }
  return undefined;
}

function assertSafeMigrationScript(dialect: Db['dialect'], script: string): void {
  for (const tokens of lexStatements(script, dialect)) {
    const classification = classifyStatement(dialect, tokens);
    if (classification) {
      throw new Error(`Unsafe ${dialect} migration statement: ${classification}.`);
    }
  }
}

function migrationMarkerSql(file: string): string {
  const escapedFile = file.replaceAll("'", "''");
  return `INSERT INTO _migrations (name, applied_at) VALUES ('${escapedFile}', ${Date.now()})`;
}

function isSqliteBusy(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('SQLITE_BUSY');
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function migrationAlreadyApplied(db: Db, file: string): Promise<boolean> {
  return Boolean(
    await db.get<{ name: string }>(sql`SELECT name FROM _migrations WHERE name = ${file} LIMIT 1`),
  );
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

async function applyMigrationOrObservePeer(db: Db, file: string, script: string): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    try {
      await applyMigrationAtomically(db, file, script);
      return true;
    } catch (error) {
      if (await migrationAlreadyApplied(db, file)) return false;
      if (
        db.dialect === 'sqlite' &&
        isSqliteBusy(error) &&
        attempt < SQLITE_BUSY_MAX_RETRIES
      ) {
        await pause(SQLITE_BUSY_RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }
  }
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
    if (await migrationAlreadyApplied(db, file)) continue;
    const script = readFileSync(join(dir, file), 'utf8');
    assertSafeMigrationScript(db.dialect, script);

    if (await applyMigrationOrObservePeer(db, file, script)) {
      applied.push(file);
    }
  }

  // Data fixups that portable SQL can't express (random short-code generation,
  // handle derivation). Idempotent + cheap no-ops once applied, so they run
  // unconditionally after the SQL migrations on both dialects.
  await applyShortLinkFixups(db);

  return applied;
}
