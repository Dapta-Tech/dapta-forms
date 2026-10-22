/**
 * The workspace link page (`account.link_page`, migration 0025): storage and
 * the reads the public page and the admin editor make.
 *
 * The blob is stored as given; `linkPageSchema` in @quill/types is the
 * contract, and both apps parse with it. This file never decides what the page
 * shows (that is `resolveLinkPage`), it only fetches what that needs.
 */
import { sql } from 'drizzle-orm';
import type { LinkPageFormRef } from '@quill/types';
import type { Db } from './client';
import { getAccountByCode, jsonParam, parseJsonColumn } from './forms';

/** The stored page blob for one workspace, or null when it has none. */
export async function getLinkPageRaw(db: Db, accountId: string): Promise<unknown> {
  const r = await db.get<{ link_page: unknown }>(
    sql`SELECT link_page FROM account WHERE id = ${accountId} LIMIT 1`,
  );
  if (!r || r.link_page == null) return null;
  return parseJsonColumn<unknown>(r.link_page, null);
}

/** Replace a workspace's page. NULL removes it, which is the same as never having had one. */
export async function setLinkPage(db: Db, accountId: string, page: unknown | null): Promise<void> {
  await db.run(
    sql`UPDATE account SET link_page = ${page == null ? null : jsonParam(page)} WHERE id = ${accountId}`,
  );
}

/** The workspace behind a public code, with its page blob. */
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
 * too rather than 404-ing only here.
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
