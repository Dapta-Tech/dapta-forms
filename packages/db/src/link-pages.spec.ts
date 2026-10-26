/**
 * Several link pages per workspace (`link_page`, migration 0027): the first
 * page is the default, slugs are unique per workspace, a workspace keeps at
 * most 20, the default page cannot be deleted, making another page the
 * default moves the flag, a renamed slug keeps redirecting, the old
 * `account.link_page` column mirrors the default page, and nothing crosses
 * workspaces. In-memory SQLite locally; DATABASE_URL for the Postgres parity job.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, sql, type Db } from './client';
import { parseJsonColumn } from './forms';
import { migrate } from './migrate';
import {
  createLinkPage,
  deleteLinkPage,
  findPublicLinkPage,
  getDefaultLinkPageRow,
  getLinkPageRow,
  listLinkPages,
  setLinkPage,
  updateLinkPage,
} from './link-page';

let db: Db;
let accountId: string;
let otherId: string;
let code: string;

const PAGE = { version: 1, enabled: true, name: 'Acme' };

async function insertAccount(id: string, accountCode: string, page: unknown = null) {
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at, link_page)
        VALUES (${id}, ${accountCode}, ${'Acme'}, ${Date.now()}, ${page == null ? null : JSON.stringify(page)})`,
  );
}

async function legacyColumn(id: string): Promise<unknown> {
  const r = await db.get<{ link_page: unknown }>(sql`SELECT link_page FROM account WHERE id = ${id}`);
  return r?.link_page == null ? null : parseJsonColumn(r.link_page, null);
}

async function create(slug: string, account = accountId, config: unknown = { version: 1, enabled: true, name: slug }) {
  const r = await createLinkPage(db, { accountId: account, name: slug, slug, config });
  if (!r.ok) throw new Error(r.reason);
  return r.value;
}

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
  accountId = randomUUID();
  otherId = randomUUID();
  code = `m${accountId.slice(0, 7)}`;
  await insertAccount(accountId, code);
  await insertAccount(otherId, `o${otherId.slice(0, 7)}`);
});

afterEach(async () => {
  await db.run(sql`DELETE FROM link_page_alias WHERE account_id IN (${accountId}, ${otherId})`);
  await db.run(sql`DELETE FROM link_page WHERE account_id IN (${accountId}, ${otherId})`);
  await db.run(sql`DELETE FROM account WHERE id IN (${accountId}, ${otherId})`);
  await db.close();
});

describe('link pages', () => {
  it('makes the first page the default and the next ones not, and lists the default first', async () => {
    const expo = await create('expo-2026');
    expect(expo.isDefault).toBe(true);
    const bio = await create('instagram');
    expect(bio.isDefault).toBe(false);
    expect((await listLinkPages(db, accountId)).map((p) => [p.slug, p.isDefault])).toEqual([
      ['expo-2026', true],
      ['instagram', false],
    ]);
  });

  it('refuses a slug another page of the workspace uses, but not one another workspace uses', async () => {
    await create('expo');
    expect(await createLinkPage(db, { accountId, name: 'x', slug: 'expo', config: PAGE })).toEqual({
      ok: false,
      reason: 'SLUG_TAKEN',
    });
    expect((await createLinkPage(db, { accountId: otherId, name: 'x', slug: 'expo', config: PAGE })).ok).toBe(true);
    const second = await create('second');
    expect(await updateLinkPage(db, accountId, second.id, { slug: 'expo' })).toEqual({ ok: false, reason: 'SLUG_TAKEN' });
  });

  it('keeps at most 20 pages per workspace', async () => {
    for (let i = 0; i < 20; i += 1) await create(`page-${i}`);
    expect(await createLinkPage(db, { accountId, name: 'x', slug: 'one-too-many', config: PAGE })).toEqual({
      ok: false,
      reason: 'LIMIT',
    });
    expect(await listLinkPages(db, accountId)).toHaveLength(20);
    // The limit is per workspace.
    expect((await createLinkPage(db, { accountId: otherId, name: 'x', slug: 'fine', config: PAGE })).ok).toBe(true);
  });

  it('never deletes the default page; deletes any other page with its retired slugs', async () => {
    const main = await create('main');
    const expo = await create('expo');
    expect(await deleteLinkPage(db, accountId, main.id)).toEqual({ ok: false, reason: 'DEFAULT_PAGE' });
    await updateLinkPage(db, accountId, expo.id, { slug: 'expo-2026' });
    expect((await deleteLinkPage(db, accountId, expo.id)).ok).toBe(true);
    expect(await getLinkPageRow(db, accountId, expo.id)).toBeNull();
    expect((await findPublicLinkPage(db, code, 'expo'))!.page).toBeNull();
    expect(await deleteLinkPage(db, accountId, expo.id)).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('makes another page the default: the flag moves, and the old default can then be deleted', async () => {
    const main = await create('main');
    const expo = await create('expo');
    const r = await updateLinkPage(db, accountId, expo.id, { makeDefault: true });
    expect(r.ok && r.value.isDefault).toBe(true);
    expect((await getDefaultLinkPageRow(db, accountId))!.id).toBe(expo.id);
    expect((await getLinkPageRow(db, accountId, main.id))!.isDefault).toBe(false);
    expect((await deleteLinkPage(db, accountId, main.id)).ok).toBe(true);
    // The public root now serves the new default.
    expect((await findPublicLinkPage(db, code, null))!.page!.id).toBe(expo.id);
  });

  it('keeps exactly one default when two pages are made default at once', async () => {
    await create('main');
    const a = await create('aaa');
    const b = await create('bbb');
    await Promise.all([
      updateLinkPage(db, accountId, a.id, { makeDefault: true }),
      updateLinkPage(db, accountId, b.id, { makeDefault: true }),
    ]);
    const defaults = (await listLinkPages(db, accountId)).filter((p) => p.isDefault);
    expect(defaults).toHaveLength(1);
  });

  it('keeps a default when a page is made default while it is being deleted, and leaves no alias behind', async () => {
    await create('main');
    const expo = await create('expo');
    // Both read the page before either writes: the race the in-transaction guard closes.
    await Promise.all([
      deleteLinkPage(db, accountId, expo.id),
      updateLinkPage(db, accountId, expo.id, { makeDefault: true, slug: 'expo-2026' }),
    ]);
    const pages = await listLinkPages(db, accountId);
    expect(pages.filter((p) => p.isDefault)).toHaveLength(1);
    const aliases = await db.all(sql`SELECT slug FROM link_page_alias WHERE account_id = ${accountId}`);
    expect(aliases).toEqual([]);
  });

  it('redirects a renamed slug to the new one, and lets a page take back a retired slug', async () => {
    const main = await create('main');
    const expo = await create('expo');
    await updateLinkPage(db, accountId, expo.id, { slug: 'expo-2026' });
    const old = await findPublicLinkPage(db, code, 'expo');
    expect(old!.page!.id).toBe(expo.id);
    expect(old!.page!.slug).toBe('expo-2026');
    // Renaming back takes the slug out of the ledger: no alias points at its own page.
    await updateLinkPage(db, accountId, expo.id, { slug: 'expo' });
    expect((await findPublicLinkPage(db, code, 'expo'))!.page!.slug).toBe('expo');
    expect((await findPublicLinkPage(db, code, 'expo-2026'))!.page!.slug).toBe('expo');
    // A new page may claim a retired slug: the live page wins over the redirect.
    const fair = await create('expo-2026');
    expect((await findPublicLinkPage(db, code, 'expo-2026'))!.page!.id).toBe(fair.id);
    expect(main.isDefault).toBe(true);
  });

  it('keeps account.link_page in step with the default page', async () => {
    const main = await create('main', accountId, PAGE);
    expect(await legacyColumn(accountId)).toEqual(PAGE);
    const expo = await create('expo', accountId, { version: 1, enabled: true, name: 'Expo' });
    expect(await legacyColumn(accountId)).toEqual(PAGE);
    await updateLinkPage(db, accountId, expo.id, { makeDefault: true });
    expect(await legacyColumn(accountId)).toEqual({ version: 1, enabled: true, name: 'Expo' });
    await updateLinkPage(db, accountId, main.id, { config: { version: 1, enabled: false } });
    expect(await legacyColumn(accountId)).toEqual({ version: 1, enabled: true, name: 'Expo' });
  });

  it('copies a page found only on account.link_page in as the default `main` page on first read', async () => {
    const legacyId = randomUUID();
    await insertAccount(legacyId, `g${legacyId.slice(0, 7)}`, PAGE);
    try {
      const pages = await listLinkPages(db, legacyId);
      expect(pages).toHaveLength(1);
      expect(pages[0]).toMatchObject({ id: `lp-${legacyId}`, slug: 'main', isDefault: true, config: PAGE });
      // A second read copies nothing twice.
      expect(await listLinkPages(db, legacyId)).toHaveLength(1);
    } finally {
      await db.run(sql`DELETE FROM link_page WHERE account_id = ${legacyId}`);
      await db.run(sql`DELETE FROM account WHERE id = ${legacyId}`);
    }
  });

  it('setLinkPage writes the default page, creates `main` when there is none, and refuses null with other pages', async () => {
    const created = await setLinkPage(db, accountId, PAGE);
    expect(created.ok && created.value).toMatchObject({ slug: 'main', isDefault: true });
    await create('expo');
    expect(await setLinkPage(db, accountId, null)).toEqual({ ok: false, reason: 'OTHER_PAGES' });
    const expo = (await listLinkPages(db, accountId)).find((p) => p.slug === 'expo')!;
    await deleteLinkPage(db, accountId, expo.id);
    expect(await setLinkPage(db, accountId, null)).toEqual({ ok: true, value: null });
    expect(await listLinkPages(db, accountId)).toEqual([]);
    expect(await legacyColumn(accountId)).toBeNull();
  });

  it('never reads, changes or deletes another workspace’s page by id', async () => {
    const theirs = await create('theirs', otherId);
    expect(await getLinkPageRow(db, accountId, theirs.id)).toBeNull();
    expect(await updateLinkPage(db, accountId, theirs.id, { name: 'mine now' })).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(await deleteLinkPage(db, accountId, theirs.id)).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect((await getLinkPageRow(db, otherId, theirs.id))!.name).toBe('theirs');
    expect((await findPublicLinkPage(db, code, 'theirs'))!.page).toBeNull();
  });
});
