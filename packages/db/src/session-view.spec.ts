/**
 * `firstSessionViewAt`: when a session first viewed a form, the anchor spam
 * protection's strict mode measures its minimum fill time from. Runs on the
 * parity job's Postgres too, so it only ever touches rows of its own account.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import { firstSessionViewAt, recordFormEvent } from './forms';

let db: Db;
let accountId: string;
let formId: string;
let otherFormId: string;

async function insertForm(name: string): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  await db.run(
    sql`INSERT INTO form (id, account_id, name, slug, config, created_at, updated_at)
        VALUES (${id}, ${accountId}, ${name}, ${'f-' + id.slice(0, 6)}, ${JSON.stringify({ version: 1, steps: [] })}, ${now}, ${now})`,
  );
  return id;
}

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
  accountId = randomUUID();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${accountId}, ${'v' + accountId.slice(0, 5)}, ${'Test'}, ${Date.now()})`,
  );
  formId = await insertForm('Form');
  otherFormId = await insertForm('Other form');
});

afterEach(async () => {
  for (const id of [formId, otherFormId]) await db.run(sql`DELETE FROM form_event WHERE form_id = ${id}`);
  await db.run(sql`DELETE FROM form WHERE account_id = ${accountId}`);
  await db.run(sql`DELETE FROM account WHERE id = ${accountId}`);
  await db.close();
});

describe('firstSessionViewAt', () => {
  it('is the earliest view of that session on that form', async () => {
    await recordFormEvent(db, { formId, sessionId: 's1', type: 'view', now: 5_000 });
    await recordFormEvent(db, { formId, sessionId: 's1', type: 'view', now: 2_000 });
    await recordFormEvent(db, { formId, sessionId: 's1', type: 'start', now: 1_000 });
    expect(await firstSessionViewAt(db, formId, 's1')).toBe(2_000);
  });

  it('is null for a session that recorded no view, whatever else it sent', async () => {
    await recordFormEvent(db, { formId, sessionId: 's2', type: 'step_complete', now: 1_000 });
    expect(await firstSessionViewAt(db, formId, 's2')).toBeNull();
    expect(await firstSessionViewAt(db, formId, 'never-seen')).toBeNull();
  });

  it('never borrows a view from another session or another form', async () => {
    await recordFormEvent(db, { formId, sessionId: 'other-session', type: 'view', now: 1_000 });
    await recordFormEvent(db, { formId: otherFormId, sessionId: 's3', type: 'view', now: 1_000 });
    expect(await firstSessionViewAt(db, formId, 's3')).toBeNull();
  });
});
