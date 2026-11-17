/**
 * A failed query must never carry its bound parameter values in the error
 * message: callers log `error.message`, and the values are answers, emails and
 * token ciphertext. drizzle-orm 0.44+ puts them there on Postgres
 * ("Failed query: ... params: ..."), so `createDb` hands back the driver error
 * instead. Runs on both dialects, like submission.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDb, runAtomically, type Db } from './client';

const SECRET = `secret-${randomUUID()}`;
let db: Db;
let table: string;

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  table = `client_error_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await db.execRaw(`CREATE TABLE ${table} (value TEXT UNIQUE)`);
  await db.run(sql`INSERT INTO ${sql.identifier(table)} (value) VALUES (${SECRET})`);
});

afterEach(async () => {
  await db.execRaw(`DROP TABLE IF EXISTS ${table}`);
  await db.close();
});

/** The unique-violation code, wherever this dialect's driver puts it. */
function uniqueCode(error: unknown): unknown {
  const e = error as { code?: unknown; cause?: { code?: unknown } };
  return e.code ?? e.cause?.code;
}

/** The SQLite handle throws synchronously, so the call itself goes inside the try. */
async function failure(attempt: () => Promise<unknown>): Promise<Error> {
  try {
    await attempt();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the query to fail');
}

describe('createDb query errors', () => {
  const duplicate = () => sql`INSERT INTO ${sql.identifier(table)} (value) VALUES (${SECRET})`;

  it('keeps bound values out of the message and the driver code reachable (run)', async () => {
    const error = await failure(() => db.run(duplicate()));
    expect(String(error.message)).not.toContain(SECRET);
    expect(['23505', 'SQLITE_CONSTRAINT_UNIQUE']).toContain(uniqueCode(error));
  });

  it('does the same for a native atomic write', async () => {
    const error = await failure(() => runAtomically(db, [duplicate()]));
    expect(String(error.message)).not.toContain(SECRET);
    expect(['23505', 'SQLITE_CONSTRAINT_UNIQUE']).toContain(uniqueCode(error));
  });

  it('surfaces the Postgres driver error itself, as before drizzle-orm 0.44', async () => {
    if (db.dialect !== 'postgres') return;
    const error = (await failure(() => db.run(duplicate()))) as Error & { code?: unknown };
    expect(error.code).toBe('23505');
    expect(error.message).not.toContain('Failed query');
  });
});
