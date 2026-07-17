/**
 * Notification-settings storage: account rows + per-form override rows in one
 * table, split by `form_id` (NULL = account scope). Honors DATABASE_URL like
 * the submission-integrity spec so the Postgres parity job exercises the same
 * scope-split uniqueness (partial indexes, migration 0005); locally it runs on
 * in-memory SQLite.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import {
  defaultNotificationSetting,
  deleteNotificationSetting,
  getNotificationSetting,
  getNotificationSettings,
  resetNotificationTemplate,
  upsertNotificationSetting,
} from './notification-settings';
import { deleteForm } from './forms';

const KEY = 'submission_confirmed';

let db: Db;
let accountId: string;
let formA: string;
let formB: string;

async function insertAccount(): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${id}, ${'t' + id.slice(0, 7)}, ${'Test'}, ${Date.now()})`,
  );
  return id;
}

/** Raw row count for one (account, key) across BOTH scopes. */
async function rowCount(acct: string, key = KEY): Promise<number> {
  const r = await db.get<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM notification_setting
        WHERE account_id = ${acct} AND email_key = ${key}`,
  );
  return Number(r?.n ?? 0);
}

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
  accountId = await insertAccount();
  formA = randomUUID();
  formB = randomUUID();
});

afterEach(async () => {
  // Postgres parity mode shares a database — leave no rows behind.
  await db.run(sql`DELETE FROM notification_setting WHERE account_id = ${accountId}`);
  await db.run(sql`DELETE FROM account WHERE id = ${accountId}`);
  await db.close();
});

describe('account scope (existing behavior, formId omitted)', () => {
  it('absent row reads as the enabled stock default', async () => {
    expect(await getNotificationSettings(db, accountId)).toEqual(new Map());
    const s = await getNotificationSetting(db, accountId, KEY);
    expect(s).toEqual(defaultNotificationSetting(KEY));
    expect(s.formId).toBeNull();
  });

  it('upsert creates then updates the ONE account row; reset NULLs the template, keeps the toggle', async () => {
    await upsertNotificationSetting(db, accountId, KEY, { enabled: false, subject: 'A {{formName}}' });
    const created = await getNotificationSetting(db, accountId, KEY);
    expect(created.enabled).toBe(false);
    expect(created.subject).toBe('A {{formName}}');
    expect(created.formId).toBeNull();

    await upsertNotificationSetting(db, accountId, KEY, { subject: 'B' });
    expect(await rowCount(accountId)).toBe(1); // updated in place, not duplicated

    const reset = await resetNotificationTemplate(db, accountId, KEY);
    expect(reset.subject).toBeNull();
    expect(reset.body).toBeNull();
    expect(reset.enabled).toBe(false); // toggle preserved
  });
});

describe('form scope', () => {
  it('a form override is a SEPARATE row: the account row and other forms are untouched', async () => {
    await upsertNotificationSetting(db, accountId, KEY, { subject: 'account {{formName}}' });
    await upsertNotificationSetting(db, accountId, KEY, { subject: 'form A', enabled: false }, Date.now(), formA);

    // Two rows for the same (account, email_key) — one per scope.
    expect(await rowCount(accountId)).toBe(2);

    // The account read never sees the form row (and vice versa).
    const account = await getNotificationSettings(db, accountId);
    expect(account.get(KEY)?.subject).toBe('account {{formName}}');
    expect(account.get(KEY)?.enabled).toBe(true);
    expect(account.get(KEY)?.formId).toBeNull();

    const overrides = await getNotificationSettings(db, accountId, formA);
    expect(overrides.get(KEY)?.subject).toBe('form A');
    expect(overrides.get(KEY)?.enabled).toBe(false);
    expect(overrides.get(KEY)?.formId).toBe(formA);

    // Form isolation: form B has no override.
    expect(await getNotificationSettings(db, accountId, formB)).toEqual(new Map());
  });

  it('upserting the same form key twice updates in place (scope-split uniqueness)', async () => {
    await upsertNotificationSetting(db, accountId, KEY, { subject: 'v1' }, Date.now(), formA);
    await upsertNotificationSetting(db, accountId, KEY, { subject: 'v2' }, Date.now(), formA);
    const overrides = await getNotificationSettings(db, accountId, formA);
    expect(overrides.get(KEY)?.subject).toBe('v2');

    // One account-less row per (account, form, key); nothing leaked to account scope.
    const r = await db.get<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM notification_setting
          WHERE account_id = ${accountId} AND email_key = ${KEY} AND form_id = ${formA}`,
    );
    expect(Number(r?.n)).toBe(1);
    expect((await getNotificationSettings(db, accountId)).size).toBe(0);
  });

  it('the DB itself rejects a duplicate form row (partial unique index)', async () => {
    // async fn: the SQLite driver throws synchronously — normalize to a rejection.
    const insert = async (id: string) =>
      db.run(
        sql`INSERT INTO notification_setting
              (id, account_id, email_key, form_id, enabled, subject, body, created_at, updated_at)
            VALUES (${id}, ${accountId}, ${KEY}, ${formA}, 1, NULL, NULL, ${Date.now()}, ${Date.now()})`,
      );
    await insert(randomUUID());
    await expect(insert(randomUUID())).rejects.toThrow();
    // …while a row for ANOTHER form with the same key is fine.
    await db.run(
      sql`INSERT INTO notification_setting
            (id, account_id, email_key, form_id, enabled, subject, body, created_at, updated_at)
          VALUES (${randomUUID()}, ${accountId}, ${KEY}, ${formB}, 1, NULL, NULL, ${Date.now()}, ${Date.now()})`,
    );
  });

  it('account isolation: another account never sees or clobbers the override', async () => {
    const otherAccount = await insertAccount();
    try {
      await upsertNotificationSetting(db, accountId, KEY, { subject: 'mine' }, Date.now(), formA);
      expect(await getNotificationSettings(db, otherAccount, formA)).toEqual(new Map());

      await upsertNotificationSetting(db, otherAccount, KEY, { subject: 'theirs' }, Date.now(), formA);
      const mine = await getNotificationSettings(db, accountId, formA);
      expect(mine.get(KEY)?.subject).toBe('mine');

      await deleteNotificationSetting(db, otherAccount, KEY, formA);
      expect((await getNotificationSettings(db, accountId, formA)).get(KEY)?.subject).toBe('mine');
    } finally {
      await db.run(sql`DELETE FROM notification_setting WHERE account_id = ${otherAccount}`);
      await db.run(sql`DELETE FROM account WHERE id = ${otherAccount}`);
    }
  });

  it('deleteForm cascades the form’s override rows (account rows survive)', async () => {
    // A real form row, so deleteForm's account-scoped delete has its subject.
    await db.run(
      sql`INSERT INTO form (id, account_id, name, slug, config, created_at, updated_at)
          VALUES (${formA}, ${accountId}, ${'Doomed'}, ${'doomed-' + formA.slice(0, 6)}, ${'{"version":1,"steps":[]}'}, ${Date.now()}, ${Date.now()})`,
    );
    await upsertNotificationSetting(db, accountId, KEY, { subject: 'account' });
    await upsertNotificationSetting(db, accountId, KEY, { subject: 'form' }, Date.now(), formA);

    await deleteForm(db, accountId, formA);

    expect(await getNotificationSettings(db, accountId, formA)).toEqual(new Map());
    expect((await getNotificationSettings(db, accountId)).get(KEY)?.subject).toBe('account');
  });

  it('deleteNotificationSetting removes ONLY the form row (idempotent), account row survives', async () => {
    await upsertNotificationSetting(db, accountId, KEY, { subject: 'account' });
    await upsertNotificationSetting(db, accountId, KEY, { subject: 'form' }, Date.now(), formA);

    await deleteNotificationSetting(db, accountId, KEY, formA);
    expect(await getNotificationSettings(db, accountId, formA)).toEqual(new Map());
    expect((await getNotificationSettings(db, accountId)).get(KEY)?.subject).toBe('account');

    // Idempotent — deleting again is a no-op.
    await deleteNotificationSetting(db, accountId, KEY, formA);
    expect(await rowCount(accountId)).toBe(1);
  });
});
