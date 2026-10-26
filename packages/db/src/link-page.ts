/**
 * Workspace link pages (`link_page`, migration 0027): storage and the reads
 * the public pages and the admin editor make.
 *
 * A workspace keeps up to `LINK_PAGE_MAX_PAGES` pages. Exactly one of them is
 * the DEFAULT while any page exists: it answers at `/{accountCode}`, the
 * others at `/{accountCode}/p/{slug}`. "At most one" is the partial unique
 * index; "at least one" is kept here: the default page is never deleted (the
 * legacy `setLinkPage(null)` on a workspace whose ONLY page it is excepted,
 * which is what `PUT /v1/link-page` with `page: null` always meant), and
 * making a page the default unsets the old one in the same transaction.
 *
 * Every write runs in one transaction that also copies the default page's
 * config onto `account.link_page`, the column the single page lived in
 * (0025). It is kept as a faithful fallback for one release: a rollback, or
 * an instance of the previous release during a deploy, reads the current
 * default page from it. A workspace whose column holds a page but that has no
 * rows yet (written by such an instance after 0027 ran) gets it copied in on
 * its next read (`ensureLegacyLinkPage`).
 *
 * The blob is stored as given; `linkPageSchema` in @quill/types is the
 * contract, and both apps parse with it. This file never decides what a page
 * shows (that is `resolveLinkPage`), it only fetches what that needs.
 */
import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { LINK_PAGE_DEFAULT_SLUG, LINK_PAGE_MAX_PAGES, type LinkPageFormRef } from '@quill/types';
import type { Db } from './client';
import { getAccountByCode, jsonParam, parseJsonColumn } from './forms';

/** How many retired slugs one page keeps redirecting. Older ones are forgotten. */
export const LINK_PAGE_MAX_ALIASES = 10;

/** One stored page. */
export interface LinkPageRow {
  id: string;
  accountId: string;
  slug: string;
  name: string;
  /** The stored blob, as stored (parse it with `parseStoredLinkPage`). */
  config: unknown;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export type LinkPageWriteFailure = 'NOT_FOUND' | 'SLUG_TAKEN' | 'LIMIT' | 'DEFAULT_PAGE' | 'OTHER_PAGES';
export type LinkPageWriteResult<T> = { ok: true; value: T } | { ok: false; reason: LinkPageWriteFailure };

const COLUMNS = sql`id, account_id, slug, name, config, is_default, created_at, updated_at`;

function toRow(r: Record<string, unknown>): LinkPageRow {
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    slug: String(r.slug),
    name: r.name == null ? '' : String(r.name),
    config: parseJsonColumn<unknown>(r.config, null),
    isDefault: Number(r.is_default) === 1 || r.is_default === true,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

// --- Errors ------------------------------------------------------------------

interface DatabaseError {
  code?: string;
  constraint?: string;
  constraint_name?: string;
  message?: string;
  cause?: unknown;
  driverError?: unknown;
}

/** A unique violation on the (account_id, slug) index, on either engine, however wrapped. */
function isSlugConflict(error: unknown, depth = 0): boolean {
  const e = error && typeof error === 'object' ? (error as DatabaseError) : undefined;
  if (!e || depth > 3) return false;
  if (e.code === '23505' && (e.constraint ?? e.constraint_name) === 'link_page_account_slug_uq') return true;
  if (
    typeof e.code === 'string' &&
    e.code.startsWith('SQLITE_CONSTRAINT') &&
    typeof e.message === 'string' &&
    e.message.includes('link_page.slug')
  ) {
    return true;
  }
  return isSlugConflict(e.cause, depth + 1) || isSlugConflict(e.driverError, depth + 1);
}

// --- Transactions ------------------------------------------------------------

/**
 * Run a workspace's link page writes as ONE transaction, followed by the
 * `account.link_page` mirror. On Postgres the transaction first takes an
 * advisory lock on the workspace, so two requests editing the same
 * workspace's pages (two "make default" clicks, two creates racing for the
 * last free slot or for the first page) run one after the other and each
 * sees the other's result. SQLite runs one write transaction at a time anyway.
 */
async function writeAtomically(db: Db, accountId: string, statements: SQL[]): Promise<void> {
  const all = [
    ...statements,
    sql`UPDATE account SET link_page = (
          SELECT config FROM link_page WHERE account_id = ${accountId} AND is_default = 1
        ) WHERE id = ${accountId}`,
  ];
  if (db.dialect === 'sqlite' && db.sqlite) {
    const native = db.sqlite;
    native.txn(() => {
      for (const statement of all) native.drizzle.run(statement);
    });
    return;
  }
  if (db.pg) {
    const lockKey = `link_page:${accountId}`;
    await db.pg.drizzle.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      for (const statement of all) await tx.execute(statement);
    });
    return;
  }
  for (const statement of all) await db.run(statement);
}

// --- Reads -------------------------------------------------------------------

/**
 * Copy a page still held only in `account.link_page` into the table, as the
 * default page. A no-op once the workspace has any row, and safe to race: the
 * id is derived from the account (the same one migration 0027 uses), so two
 * concurrent reads insert one row.
 */
export async function ensureLegacyLinkPage(db: Db, accountId: string): Promise<void> {
  const has = await db.get(sql`SELECT 1 AS x FROM link_page WHERE account_id = ${accountId} LIMIT 1`);
  if (has) return;
  const legacy = await db.get<{ link_page: unknown }>(
    sql`SELECT link_page FROM account WHERE id = ${accountId} LIMIT 1`,
  );
  const blob = legacy?.link_page == null ? null : parseJsonColumn<unknown>(legacy.link_page, null);
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) return;
  const now = Date.now();
  await db.run(
    sql`INSERT INTO link_page (id, account_id, slug, name, config, is_default, created_at, updated_at)
        VALUES (${`lp-${accountId}`}, ${accountId}, ${LINK_PAGE_DEFAULT_SLUG}, '', ${jsonParam(blob)}, 1, ${now}, ${now})
        ON CONFLICT DO NOTHING`,
  );
}

/** Every page of the workspace: the default first, then oldest first. */
export async function listLinkPages(db: Db, accountId: string): Promise<LinkPageRow[]> {
  await ensureLegacyLinkPage(db, accountId);
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT ${COLUMNS} FROM link_page WHERE account_id = ${accountId}
        ORDER BY is_default DESC, created_at ASC, id ASC`,
  );
  return rows.map(toRow);
}

/** One page of THIS workspace, or null (another workspace's id reads as missing). */
export async function getLinkPageRow(db: Db, accountId: string, id: string): Promise<LinkPageRow | null> {
  await ensureLegacyLinkPage(db, accountId);
  const r = await db.get<Record<string, unknown>>(
    sql`SELECT ${COLUMNS} FROM link_page WHERE account_id = ${accountId} AND id = ${id} LIMIT 1`,
  );
  return r ? toRow(r) : null;
}

/** The workspace's default page, or null when it has no page at all. */
export async function getDefaultLinkPageRow(db: Db, accountId: string): Promise<LinkPageRow | null> {
  await ensureLegacyLinkPage(db, accountId);
  const r = await db.get<Record<string, unknown>>(
    sql`SELECT ${COLUMNS} FROM link_page WHERE account_id = ${accountId} AND is_default = 1 LIMIT 1`,
  );
  return r ? toRow(r) : null;
}

/** The default page's stored blob, or null when the workspace has no page. */
export async function getLinkPageRaw(db: Db, accountId: string): Promise<unknown> {
  return (await getDefaultLinkPageRow(db, accountId))?.config ?? null;
}

/** Every slug the workspace's pages use right now. */
async function slugsInUse(db: Db, accountId: string): Promise<Set<string>> {
  const rows = await db.all<{ slug: string }>(sql`SELECT slug FROM link_page WHERE account_id = ${accountId}`);
  return new Set(rows.map((r) => String(r.slug)));
}

export { slugsInUse as linkPageSlugsInUse };

/** The workspace behind a public code, with its default page's blob. */
export interface LinkPageAccountRow {
  accountId: string;
  /** The canonical code, even when the URL used a vanity or retired one. */
  accountCode: string;
  accountName: string;
  page: unknown;
}

/**
 * Resolve a public URL's code to its workspace through the SAME lookup the
 * public form route uses, so a vanity slug or a retired code reaches the page
 * too rather than 404-ing only here. `page` is the DEFAULT page's blob.
 */
export async function getLinkPageByCode(db: Db, accountCode: string): Promise<LinkPageAccountRow | null> {
  const account = await getAccountByCode(db, accountCode);
  if (!account) return null;
  return {
    accountId: String(account.id),
    accountCode: String(account.code),
    accountName: String(account.name),
    page: await getLinkPageRaw(db, String(account.id)),
  };
}

/** A public request resolved: the workspace and the page (null when none matches). */
export interface PublicLinkPageLookup {
  accountId: string;
  accountCode: string;
  accountName: string;
  page: LinkPageRow | null;
}

/**
 * The page a public URL names. `slug` null is `/{accountCode}`, the default
 * page. Otherwise the page whose CURRENT slug it is, else the page that used
 * to have it (a retired slug in the alias ledger); the caller compares the
 * page's slug with the requested one to redirect. Null when the code names no
 * workspace.
 */
export async function findPublicLinkPage(
  db: Db,
  accountCode: string,
  slug: string | null,
): Promise<PublicLinkPageLookup | null> {
  const account = await getAccountByCode(db, accountCode);
  if (!account) return null;
  const accountId = String(account.id);
  const base = { accountId, accountCode: String(account.code), accountName: String(account.name) };
  if (slug == null) return { ...base, page: await getDefaultLinkPageRow(db, accountId) };
  await ensureLegacyLinkPage(db, accountId);
  const wanted = slug.toLowerCase();
  const direct = await db.get<Record<string, unknown>>(
    sql`SELECT ${COLUMNS} FROM link_page WHERE account_id = ${accountId} AND slug = ${wanted} LIMIT 1`,
  );
  if (direct) return { ...base, page: toRow(direct) };
  const viaAlias = await db.get<Record<string, unknown>>(
    sql`SELECT p.id, p.account_id, p.slug, p.name, p.config, p.is_default, p.created_at, p.updated_at
        FROM link_page_alias a JOIN link_page p ON p.id = a.page_id AND p.account_id = a.account_id
        WHERE a.account_id = ${accountId} AND a.slug = ${wanted} LIMIT 1`,
  );
  return { ...base, page: viaAlias ? toRow(viaAlias) : null };
}

// --- Writes ------------------------------------------------------------------

export interface NewLinkPage {
  accountId: string;
  name: string;
  slug: string;
  config: unknown;
  now?: number;
  limit?: number;
}

/**
 * Add a page. The workspace's first page becomes its default; any later one
 * is not. Refused with `LIMIT` past `limit` pages, `SLUG_TAKEN` when another
 * page already has the slug. A slug in the alias ledger is reclaimed: the
 * live page wins over a redirect.
 */
export async function createLinkPage(db: Db, input: NewLinkPage): Promise<LinkPageWriteResult<LinkPageRow>> {
  const { accountId, slug } = input;
  const now = input.now ?? Date.now();
  const limit = input.limit ?? LINK_PAGE_MAX_PAGES;
  await ensureLegacyLinkPage(db, accountId);
  const id = randomUUID();
  try {
    await writeAtomically(db, accountId, [
      sql`DELETE FROM link_page_alias WHERE account_id = ${accountId} AND slug = ${slug}
            AND (SELECT COUNT(*) FROM link_page WHERE account_id = ${accountId}) < ${limit}`,
      sql`INSERT INTO link_page (id, account_id, slug, name, config, is_default, created_at, updated_at)
          SELECT ${id}, ${accountId}, ${slug}, ${input.name}, ${jsonParam(input.config)},
                 CASE WHEN EXISTS (SELECT 1 FROM link_page WHERE account_id = ${accountId} AND is_default = 1)
                      THEN 0 ELSE 1 END,
                 ${now}, ${now}
          WHERE (SELECT COUNT(*) FROM link_page WHERE account_id = ${accountId}) < ${limit}`,
    ]);
  } catch (err) {
    if (isSlugConflict(err)) return { ok: false, reason: 'SLUG_TAKEN' };
    throw err;
  }
  const row = await getLinkPageRow(db, accountId, id);
  return row ? { ok: true, value: row } : { ok: false, reason: 'LIMIT' };
}

export interface LinkPagePatch {
  name?: string;
  slug?: string;
  /** The whole new blob. Absent keeps the stored one. */
  config?: unknown;
  /** Make this page the default (the old default stops being it). */
  makeDefault?: boolean;
  now?: number;
}

/**
 * Change a page. A new slug retires the old one into the alias ledger (it
 * redirects to the new one) and takes the new one out of it, so no slug ever
 * redirects to the page that holds it. Only the newest
 * `LINK_PAGE_MAX_ALIASES` retired slugs of a page are kept.
 */
export async function updateLinkPage(
  db: Db,
  accountId: string,
  id: string,
  patch: LinkPagePatch,
): Promise<LinkPageWriteResult<LinkPageRow>> {
  const current = await getLinkPageRow(db, accountId, id);
  if (!current) return { ok: false, reason: 'NOT_FOUND' };
  const now = patch.now ?? Date.now();
  const statements: SQL[] = [];
  const nextSlug = patch.slug !== undefined && patch.slug !== current.slug ? patch.slug : null;
  if (nextSlug) {
    statements.push(
      sql`DELETE FROM link_page_alias WHERE account_id = ${accountId} AND slug = ${nextSlug}`,
      sql`INSERT INTO link_page_alias (account_id, slug, page_id, created_at)
          VALUES (${accountId}, ${current.slug}, ${id}, ${now})
          ON CONFLICT (account_id, slug) DO UPDATE SET page_id = ${id}, created_at = ${now}`,
      sql`UPDATE link_page SET slug = ${nextSlug} WHERE account_id = ${accountId} AND id = ${id}`,
      sql`DELETE FROM link_page_alias WHERE account_id = ${accountId} AND page_id = ${id}
            AND slug NOT IN (
              SELECT slug FROM link_page_alias WHERE account_id = ${accountId} AND page_id = ${id}
              ORDER BY created_at DESC, slug ASC LIMIT ${LINK_PAGE_MAX_ALIASES}
            )`,
    );
  }
  if (patch.name !== undefined) {
    statements.push(sql`UPDATE link_page SET name = ${patch.name} WHERE account_id = ${accountId} AND id = ${id}`);
  }
  if (patch.config !== undefined) {
    statements.push(
      sql`UPDATE link_page SET config = ${jsonParam(patch.config)} WHERE account_id = ${accountId} AND id = ${id}`,
    );
  }
  if (patch.makeDefault && !current.isDefault) {
    // Unset first: the partial unique index allows one default at a time.
    statements.push(
      sql`UPDATE link_page SET is_default = 0 WHERE account_id = ${accountId} AND is_default = 1 AND id <> ${id}`,
      sql`UPDATE link_page SET is_default = 1 WHERE account_id = ${accountId} AND id = ${id}`,
    );
  }
  statements.push(sql`UPDATE link_page SET updated_at = ${now} WHERE account_id = ${accountId} AND id = ${id}`);
  try {
    await writeAtomically(db, accountId, statements);
  } catch (err) {
    if (isSlugConflict(err)) return { ok: false, reason: 'SLUG_TAKEN' };
    throw err;
  }
  const row = await getLinkPageRow(db, accountId, id);
  return row ? { ok: true, value: row } : { ok: false, reason: 'NOT_FOUND' };
}

/**
 * Delete a page and its retired slugs. The default page is refused
 * (`DEFAULT_PAGE`): make another page the default first. The guard is in the
 * statement itself, so a concurrent "make default" cannot slip between the
 * check and the delete.
 */
export async function deleteLinkPage(db: Db, accountId: string, id: string): Promise<LinkPageWriteResult<LinkPageRow>> {
  const current = await getLinkPageRow(db, accountId, id);
  if (!current) return { ok: false, reason: 'NOT_FOUND' };
  if (current.isDefault) return { ok: false, reason: 'DEFAULT_PAGE' };
  await writeAtomically(db, accountId, [
    sql`DELETE FROM link_page_alias WHERE account_id = ${accountId} AND page_id = ${id}
          AND EXISTS (SELECT 1 FROM link_page WHERE account_id = ${accountId} AND id = ${id} AND is_default = 0)`,
    sql`DELETE FROM link_page WHERE account_id = ${accountId} AND id = ${id} AND is_default = 0`,
  ]);
  const after = await getLinkPageRow(db, accountId, id);
  if (after) return { ok: false, reason: after.isDefault ? 'DEFAULT_PAGE' : 'NOT_FOUND' };
  return { ok: true, value: current };
}

/**
 * The single-page write `PUT /v1/link-page` has always made, on the DEFAULT
 * page: replace its blob, or create it (slug `main`, or the first free one)
 * when the workspace has no page yet. `null` removes the page, as it always
 * did, when it is the workspace's only one; with other pages it is refused
 * (`OTHER_PAGES`), since a workspace with pages always has a default.
 */
export async function setLinkPage(db: Db, accountId: string, page: unknown | null): Promise<LinkPageWriteResult<LinkPageRow | null>> {
  const current = await getDefaultLinkPageRow(db, accountId);
  if (page == null) {
    if (!current) {
      // Nothing to remove; make sure no stale blob is left on the column either.
      await writeAtomically(db, accountId, []);
      return { ok: true, value: null };
    }
    const count = (await listLinkPages(db, accountId)).length;
    if (count > 1) return { ok: false, reason: 'OTHER_PAGES' };
    await writeAtomically(db, accountId, [
      sql`DELETE FROM link_page_alias WHERE account_id = ${accountId} AND page_id = ${current.id}`,
      sql`DELETE FROM link_page WHERE account_id = ${accountId} AND id = ${current.id}
            AND (SELECT COUNT(*) FROM link_page WHERE account_id = ${accountId}) = 1`,
    ]);
    return { ok: true, value: null };
  }
  if (current) return updateLinkPage(db, accountId, current.id, { config: page });
  const taken = await slugsInUse(db, accountId);
  let slug = LINK_PAGE_DEFAULT_SLUG;
  for (let n = 2; taken.has(slug); n += 1) slug = `${LINK_PAGE_DEFAULT_SLUG}-${n}`;
  return createLinkPage(db, { accountId, name: '', slug, config: page });
}

// --- Forms -------------------------------------------------------------------

/**
 * Every form in the workspace, as the page and its editor name them.
 *
 * A form is live from the moment it exists (its `config` IS the published
 * version; edits wait in `draft_config`), so "every form" and "every published
 * form" are the same list. A deleted form is simply absent, which is what
 * drops its button from the page. `config` rides along only for the public
 * title, extracted in JS because the column is jsonb on Postgres and TEXT on
 * SQLite.
 */
export async function listLinkPageForms(db: Db, accountId: string): Promise<LinkPageFormRef[]> {
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT id, slug, name, config FROM form WHERE account_id = ${accountId} ORDER BY created_at ASC`,
  );
  return rows.map((r) => {
    const config = parseJsonColumn<{ title?: unknown }>(r.config, {});
    const title = typeof config.title === 'string' && config.title.trim() ? config.title.trim() : null;
    return { id: String(r.id), slug: String(r.slug), name: String(r.name), title };
  });
}
