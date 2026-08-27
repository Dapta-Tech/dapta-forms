/**
 * Form creation must keep account-scoped slugs deterministic even when two
 * independent writers choose the same candidate before either can insert it.
 * The suite defaults to a shared SQLite file so the writers are real separate
 * connections; CI can set DATABASE_URL to run the same assertions on Postgres.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, type SQL } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import { createForm, duplicateForm } from './forms';

let writerOne: Db;
let writerTwo: Db;
let accountId: string;
let otherAccountId: string;
let sqliteDir: string | undefined;

type Barrier = { wait: () => Promise<void> };
type DbError = Error & { code?: string; constraint?: string; constraint_name?: string };

function twoWriterBarrier(): Barrier {
  let arrivals = 0;
  let release!: () => void;
  const bothArrived = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    async wait(): Promise<void> {
      arrivals += 1;
      if (arrivals === 2) release();
      await bothArrived;
    },
  };
}

/**
 * `createForm` starts with uniqueFormSlug's lookup. Holding that one lookup on
 * each independently connected writer proves both chose the same candidate
 * before either reaches the unique index; a sequential duplicate test cannot.
 */
function pauseAfterFirstLookup(db: Db, barrier: Barrier): Db {
  let firstLookup = true;
  return {
    ...db,
    get: async <T = Record<string, unknown>>(query: SQL): Promise<T | undefined> => {
      const row = await db.get<T>(query);
      if (firstLookup) {
        firstLookup = false;
        await barrier.wait();
      }
      return row;
    },
  };
}

function formSlugConflict(dialect: Db['dialect']): DbError {
  return dialect === 'postgres'
    ? Object.assign(new Error('duplicate key value violates unique constraint "form_account_slug_uq"'), {
        code: '23505',
        constraint_name: 'form_account_slug_uq',
      })
    : Object.assign(new Error('UNIQUE constraint failed: form.account_id, form.slug'), {
        code: 'SQLITE_CONSTRAINT_UNIQUE',
      });
}

function rejectEveryFormInsert(db: Db, attempts: { count: number; error: DbError }): Db {
  return {
    ...db,
    run: async (_query: SQL): Promise<void> => {
      attempts.count += 1;
      throw attempts.error;
    },
  };
}

function countFormInserts(db: Db, attempts: { count: number }): Db {
  return {
    ...db,
    run: async (query: SQL): Promise<void> => {
      attempts.count += 1;
      await db.run(query);
    },
  };
}

beforeEach(async () => {
  const databaseUrl = process.env.DATABASE_URL ?? `file:${join(await mkdtemp(join(tmpdir(), 'quill-form-slug-')), 'forms.db')}`;
  if (!process.env.DATABASE_URL) sqliteDir = join(databaseUrl.slice('file:'.length), '..');

  writerOne = await createDb(databaseUrl);
  writerTwo = await createDb(databaseUrl);
  await migrate(writerOne);

  accountId = randomUUID();
  otherAccountId = randomUUID();
  const now = Date.now();
  await writerOne.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${accountId}, ${`a${accountId.slice(0, 8)}`}, ${'Primary'}, ${now})`,
  );
  await writerOne.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${otherAccountId}, ${`b${otherAccountId.slice(0, 8)}`}, ${'Other'}, ${now})`,
  );
});

afterEach(async () => {
  if (writerOne) {
    await writerOne.run(sql`DELETE FROM form WHERE account_id = ${accountId} OR account_id = ${otherAccountId}`);
    await writerOne.run(sql`DELETE FROM account WHERE id = ${accountId} OR id = ${otherAccountId}`);
  }
  await writerTwo?.close();
  await writerOne?.close();
  if (sqliteDir) await rm(sqliteDir, { recursive: true, force: true });
  sqliteDir = undefined;
});

describe('createForm slug allocation', () => {
  it('retries the loser after two writers select the same slug', async () => {
    const barrier = twoWriterBarrier();
    const results = await Promise.all([
      createForm(pauseAfterFirstLookup(writerOne, barrier), accountId, { name: 'Launch Plan' }),
      createForm(pauseAfterFirstLookup(writerTwo, barrier), accountId, { name: 'Launch Plan' }),
    ]);

    const slugs = results.map((result) => {
      if (!result.ok) throw new Error('expected both concurrent creates to succeed');
      return result.value.slug;
    });
    expect(new Set(slugs)).toEqual(new Set(['launch-plan', 'launch-plan-2']));
  });

  it('keeps ordinary suffixing and cross-account reuse unchanged', async () => {
    const first = await createForm(writerOne, accountId, { name: 'Weekly Check-in' });
    const second = await createForm(writerOne, accountId, { name: 'Weekly Check-in' });
    const otherAccount = await createForm(writerOne, otherAccountId, { name: 'Weekly Check-in' });

    expect(first).toMatchObject({ ok: true, value: { slug: 'weekly-check-in' } });
    expect(second).toMatchObject({ ok: true, value: { slug: 'weekly-check-in-2' } });
    expect(otherAccount).toMatchObject({ ok: true, value: { slug: 'weekly-check-in' } });
  });

  it('preserves non-slug database errors', async () => {
    const attempts = { count: 0 };
    await expect(
      createForm(countFormInserts(writerOne, attempts), accountId, {
        name: null as unknown as string,
        slug: 'not-null-control',
      }),
    ).rejects.toThrow();
    expect(attempts.count).toBe(1);
  });

  it('stops after three matching slug conflicts and rethrows the original error', async () => {
    const attempts = { count: 0, error: formSlugConflict(writerOne.dialect) };

    await expect(
      createForm(rejectEveryFormInsert(writerOne, attempts), accountId, { name: 'Bounded Retry' }),
    ).rejects.toBe(attempts.error);
    expect(attempts.count).toBe(3);
  });
});

/**
 * The HubSpot mirror-form pointer is OWNED state: `formGuid` names the mirror
 * form the API minted for the ORIGINAL, and a copy that inherits it posts its
 * submissions at the original's form — every lead the copy collects shows up
 * attributed to the original, and integration saves on either form rename the
 * shared mirror back and forth. The duplicate must shed the pair so its first
 * integrations save mints its own mirror. Everything else copies verbatim.
 */
describe('duplicateForm strips the owned mirror state', () => {
  it('drops formGuid + formSignature from a HubSpot destination, keeps the rest', async () => {
    const src = await createForm(writerOne, accountId, {
      name: 'Booking Sorteo',
      config: {
        version: 1,
        steps: [],
        destinations: [
          {
            type: 'hubspot',
            enabled: true,
            settings: {
              note: false,
              formActivity: true,
              formGuid: 'guid-of-the-original',
              formSignature: '["Booking Sorteo (Dapta Forms)",["email"]]',
            },
            fieldMappings: { email: 'email' },
          },
          { type: 'webhook', enabled: true, settings: { url: 'https://example.com/hook' } },
        ],
      },
    });
    if (!src.ok) throw new Error('createForm failed');

    const copy = await duplicateForm(writerOne, accountId, src.value.id);
    if (!copy.ok) throw new Error('duplicateForm failed');
    const destinations = (copy.value.config as {
      destinations: Array<{ type: string; settings: Record<string, unknown>; fieldMappings?: unknown }>;
    }).destinations;

    const hubspot = destinations.find((d) => d.type === 'hubspot')!;
    expect(hubspot.settings.formGuid).toBeUndefined();
    expect(hubspot.settings.formSignature).toBeUndefined();
    // The author-owned settings and mappings survive the copy.
    expect(hubspot.settings.formActivity).toBe(true);
    expect(hubspot.settings.note).toBe(false);
    expect(hubspot.fieldMappings).toEqual({ email: 'email' });
    // Non-HubSpot destinations copy untouched.
    expect(destinations.find((d) => d.type === 'webhook')!.settings.url).toBe(
      'https://example.com/hook',
    );
    // The ORIGINAL keeps its mirror pointer — only the copy sheds it. The raw
    // column is text on SQLite and an already-parsed object on Postgres
    // (jsonb), so normalise to JSON text before the substring check.
    const original = await writerOne.get<{ config: unknown }>(
      sql`SELECT config FROM form WHERE id = ${src.value.id}`,
    );
    const rawConfig = original!.config;
    const configText = typeof rawConfig === 'string' ? rawConfig : JSON.stringify(rawConfig);
    expect(configText).toContain('guid-of-the-original');
  });

  it('leaves a config with no destinations alone', async () => {
    const src = await createForm(writerOne, accountId, {
      name: 'Plain',
      config: { version: 1, steps: [] },
    });
    if (!src.ok) throw new Error('createForm failed');
    const copy = await duplicateForm(writerOne, accountId, src.value.id);
    if (!copy.ok) throw new Error('duplicateForm failed');
    expect(copy.value.config).toEqual({ version: 1, steps: [] });
  });
});
