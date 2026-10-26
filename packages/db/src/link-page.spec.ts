/**
 * The workspace link page column (migration 0025): a workspace starts with no
 * page, a save round-trips, a clear goes back to null, the public lookup
 * resolves the canonical code, and the form listing is scoped to the
 * workspace. In-memory SQLite locally; DATABASE_URL for the Postgres parity job.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, sql, type Db } from './client';
import { migrate } from './migrate';
import { getLinkPageByCode, getLinkPageRaw, listLinkPageForms, setLinkPage } from './link-page';

let db: Db;
let accountId: string;
let otherId: string;
let code: string;

async function insertAccount(id: string, accountCode: string, name: string) {
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at) VALUES (${id}, ${accountCode}, ${name}, ${Date.now()})`,
  );
}

async function insertForm(account: string, slug: string, name: string, config: unknown, at: number) {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO form (id, account_id, name, slug, config, created_at, updated_at)
        VALUES (${id}, ${account}, ${name}, ${slug}, ${JSON.stringify(config)}, ${at}, ${at})`,
  );
  return id;
}

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
  accountId = randomUUID();
  otherId = randomUUID();
  code = `l${accountId.slice(0, 7)}`;
  await insertAccount(accountId, code, 'Acme');
  await insertAccount(otherId, `o${otherId.slice(0, 7)}`, 'Other');
});

afterEach(async () => {
  await db.run(sql`DELETE FROM link_page WHERE account_id IN (${accountId}, ${otherId})`);
  await db.run(sql`DELETE FROM form WHERE account_id IN (${accountId}, ${otherId})`);
  await db.run(sql`DELETE FROM account WHERE id IN (${accountId}, ${otherId})`);
  await db.close();
});

describe('workspace link page storage', () => {
  it('starts with no page, round-trips a save, and clears back to null', async () => {
    expect(await getLinkPageRaw(db, accountId)).toBeNull();
    const page = { version: 1, enabled: true, name: 'Acme', items: [{ type: 'link', label: 'Site', url: 'https://acme.example' }] };
    await setLinkPage(db, accountId, page);
    expect(await getLinkPageRaw(db, accountId)).toEqual(page);
    // Another workspace is untouched.
    expect(await getLinkPageRaw(db, otherId)).toBeNull();
    await setLinkPage(db, accountId, null);
    expect(await getLinkPageRaw(db, accountId)).toBeNull();
  });

  it('resolves the public code to the workspace and its page', async () => {
    await setLinkPage(db, accountId, { version: 1, enabled: true });
    const row = await getLinkPageByCode(db, code);
    expect(row).toEqual({ accountId, accountCode: code, accountName: 'Acme', page: { version: 1, enabled: true } });
    expect(await getLinkPageByCode(db, 'no-such-code')).toBeNull();
  });

  it('lists only this workspace’s forms, oldest first, with the public title when set', async () => {
    const now = Date.now();
    const a = await insertForm(accountId, 'contact', 'Contact (internal)', { version: 1, steps: [], title: ' Talk to us ' }, now);
    const b = await insertForm(accountId, 'quote', 'Quote', { version: 1, steps: [] }, now + 1);
    await insertForm(otherId, 'theirs', 'Theirs', { version: 1, steps: [] }, now);
    expect(await listLinkPageForms(db, accountId)).toEqual([
      { id: a, slug: 'contact', name: 'Contact (internal)', title: 'Talk to us' },
      { id: b, slug: 'quote', name: 'Quote', title: null },
    ]);
  });
});
