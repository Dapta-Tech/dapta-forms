/**
 * Several link pages per workspace through the API:
 *
 *   1. `/v1/link-page` keeps meaning the default page (backward compatible);
 *   2. `/v1/link-pages` lists, creates, reads, edits, copies and deletes pages;
 *   3. slugs follow the vanity rules (shape + reserved words) and stay unique;
 *   4. the default page cannot be deleted; another page can be made default;
 *   5. a copy is switched off, never the default, under a new slug;
 *   6. a public page answers by slug, a retired slug answers with the current
 *      one, and an off or missing page is a 404;
 *   7. events carry `page_slug` and `page_id`;
 *   8. nothing crosses workspaces.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { createDb, getAccountByCode, migrate, seed, sql, upsertAccountBranding, type Db } from '@quill/db';
import type { ServerEnv } from '@quill/config/env';
import { LINK_PAGE_MAX_PAGES } from '@quill/types';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';
import { AnalyticsEffects } from './analytics-effects';
import { LinkPageController } from './link-page.controller';
import { LinkPageService } from './link-page.service';
import { PublicController } from './public.controller';
import { SubmissionService } from './submission.service';

let db: Db;
let editor: LinkPageController;
let publicApi: PublicController;
let accountId: string;
let accountCode: string;

const asOwner = (): ReqLike => ({ headers: {} });
const asEmail = (email: string): ReqLike => ({ headers: { 'x-quill-email': email } });
const env = { PUBLIC_APP_URL: 'https://forms.example.com' } as ServerEnv;

async function failure(p: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await p;
  } catch (err) {
    if (err instanceof HttpException) return { status: err.getStatus(), body: err.getResponse() as Record<string, unknown> };
    throw err;
  }
  throw new Error('expected a refusal');
}

async function addForm(account: string, slug: string): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO form (id, account_id, name, slug, config, created_at, updated_at)
        VALUES (${id}, ${account}, ${slug}, ${slug}, ${'{"version":1,"steps":[]}'}, ${Date.now()}, ${Date.now()})`,
  );
  return id;
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
  const account = (await getAccountByCode(db, 'acme'))!;
  accountId = account.id;
  accountCode = account.code;
  const provider = new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });
  const analytics = new AnalyticsEffects(db, { PRODUCT_ANALYTICS_KEY: 'phc_test' } as ServerEnv);
  const pages = new LinkPageService(db, analytics);
  editor = new LinkPageController(new AuthService(db, provider), pages, env);
  publicApi = new PublicController({} as SubmissionService, {} as never, undefined, pages);
});

afterEach(async () => {
  await db.close();
});

describe('several link pages per workspace', () => {
  it('keeps GET/PUT /v1/link-page on the default page, which keeps its address', async () => {
    await editor.put(asOwner(), { page: { version: 1, enabled: true, name: 'Main' } });
    const legacy = await editor.get(asOwner());
    expect(legacy).toMatchObject({ slug: 'main', isDefault: true, publicUrl: `https://forms.example.com/${accountCode}`, live: true });
    const expo = await editor.create(asOwner(), { name: 'Expo 2026', slug: 'expo-2026', page: { version: 1, enabled: true, name: 'Expo' } });
    expect(expo).toMatchObject({ isDefault: false, publicUrl: `https://forms.example.com/${accountCode}/p/expo-2026` });
    // The legacy routes still read and write the default page only.
    await editor.put(asOwner(), { page: { version: 1, enabled: true, name: 'Main, edited' } });
    expect((await editor.get(asOwner())).page?.name).toBe('Main, edited');
    expect((await editor.one(asOwner(), expo.id!)).page?.name).toBe('Expo');
    expect((await publicApi.linkPage(accountCode)).name).toBe('Main, edited');
    // `page: null` cannot delete a default page that has siblings.
    expect(await failure(editor.put(asOwner(), { page: null }))).toMatchObject({ status: 409, body: { error: 'DEFAULT_PAGE' } });
  });

  it('creates the first page as the default, makes a slug from the name, and refuses a taken or reserved slug', async () => {
    const first = await editor.create(asOwner(), { name: 'Feria Ñandú 2026' });
    expect(first).toMatchObject({ slug: 'feria-nandu-2026', isDefault: true, live: false });
    const second = await editor.create(asOwner(), { name: 'Feria Ñandú 2026' });
    expect(second.slug).toBe('feria-nandu-2026-2');
    expect(await failure(editor.create(asOwner(), { slug: 'feria-nandu-2026' }))).toMatchObject({ status: 409, body: { error: 'SLUG_TAKEN' } });
    expect((await failure(editor.create(asOwner(), { slug: 'admin' }))).status).toBe(400);
    expect((await failure(editor.create(asOwner(), { slug: 'No Spaces' }))).status).toBe(400);
    // Lowercased on the way in.
    expect((await editor.create(asOwner(), { slug: 'INSTAGRAM' })).slug).toBe('instagram');
  });

  it(`stops at ${LINK_PAGE_MAX_PAGES} pages`, async () => {
    for (let i = 0; i < LINK_PAGE_MAX_PAGES; i += 1) await editor.create(asOwner(), { slug: `page-${i}` });
    expect(await failure(editor.create(asOwner(), { slug: 'one-more' }))).toMatchObject({ status: 409, body: { error: 'PAGE_LIMIT' } });
    const list = await editor.list(asOwner());
    expect(list.pages).toHaveLength(LINK_PAGE_MAX_PAGES);
    expect(list.max).toBe(LINK_PAGE_MAX_PAGES);
    expect(list.pages[0]!.isDefault).toBe(true);
  });

  it('refuses to delete the default page, and deletes it once another page is the default', async () => {
    const main = await editor.create(asOwner(), { slug: 'main' });
    const expo = await editor.create(asOwner(), { slug: 'expo', page: { version: 1, enabled: true } });
    expect(await failure(editor.remove(asOwner(), main.id!))).toMatchObject({ status: 409, body: { error: 'DEFAULT_PAGE' } });
    const promoted = await editor.update(asOwner(), expo.id!, { isDefault: true });
    expect(promoted).toMatchObject({ isDefault: true, publicUrl: `https://forms.example.com/${accountCode}` });
    expect((await failure(editor.update(asOwner(), expo.id!, { isDefault: false }))).status).toBe(400);
    expect(await editor.remove(asOwner(), main.id!)).toEqual({ ok: true, id: main.id, slug: 'main' });
    expect((await publicApi.linkPage(accountCode)).pageSlug).toBe('expo');
  });

  it('duplicates a page switched off, not default, with a new slug and the same buttons', async () => {
    const form = await addForm(accountId, 'quote');
    const main = await editor.create(asOwner(), {
      name: 'Expo',
      slug: 'expo',
      page: { version: 1, enabled: true, items: [{ type: 'form', formId: form }], colors: { primaryColor: '#112233' } },
    });
    const copy = await editor.duplicate(asOwner(), main.id!, {});
    expect(copy).toMatchObject({ slug: 'expo-2', name: 'Expo', isDefault: false, live: false });
    expect(copy.page).toMatchObject({ enabled: false, items: [{ type: 'form', formId: form }], colors: { primaryColor: '#112233' } });
    const named = await editor.duplicate(asOwner(), main.id!, { name: 'Expo 2027', slug: 'expo-2027' });
    expect(named).toMatchObject({ slug: 'expo-2027', name: 'Expo 2027' });
    expect((await publicApi.linkPage(accountCode)).isDefault).toBe(true);
  });

  it('serves a page by slug, redirects a retired slug, and 404s when off, missing or deleted', async () => {
    await editor.create(asOwner(), { slug: 'main', page: { version: 1, enabled: true } });
    const expo = await editor.create(asOwner(), { slug: 'expo', page: { version: 1, enabled: false, name: 'Expo' } });
    const status = async (slug: string) => (await failure(publicApi.linkPageBySlug(accountCode, slug)).catch(() => ({ status: 200 }))).status;
    expect(await status('expo')).toBe(404);
    await editor.update(asOwner(), expo.id!, { page: { version: 1, enabled: true, name: 'Expo' } });
    expect(await publicApi.linkPageBySlug(accountCode, 'expo')).toMatchObject({ name: 'Expo', pageSlug: 'expo', isDefault: false });
    await editor.update(asOwner(), expo.id!, { slug: 'expo-2026' });
    expect((await publicApi.linkPageBySlug(accountCode, 'expo')).pageSlug).toBe('expo-2026');
    expect((await publicApi.linkPageBySlug(accountCode, 'EXPO-2026')).pageSlug).toBe('expo-2026');
    expect(await status('nothing-here')).toBe(404);
    // The default page also answers by its slug, flagged so the web can send it to /{code}.
    expect((await publicApi.linkPageBySlug(accountCode, 'main')).isDefault).toBe(true);
    await editor.remove(asOwner(), expo.id!);
    expect(await status('expo-2026')).toBe(404);
    expect(await status('expo')).toBe(404);
  });

  it('styles a page with its own colours over the brand kit, field by field', async () => {
    await upsertAccountBranding(db, accountId, { primaryColor: '#000000', background: '#ffffff' });
    await editor.create(asOwner(), { slug: 'main', page: { version: 1, enabled: true } });
    await editor.create(asOwner(), { slug: 'expo', page: { version: 1, enabled: true, colors: { primaryColor: '#ff0000' } } });
    const main = await publicApi.linkPage(accountCode);
    const expo = await publicApi.linkPageBySlug(accountCode, 'expo');
    expect(expo.branding.primaryColor).toBe('#ff0000');
    expect(expo.branding.background).toBe(main.branding.background);
    expect(main.branding.primaryColor).not.toBe('#ff0000');
  });

  it('tags each event with the page it happened on', async () => {
    await editor.create(asOwner(), { slug: 'main', page: { version: 1, enabled: true } });
    const expo = await editor.create(asOwner(), { slug: 'expo', page: { version: 1, enabled: true } });
    await publicApi.linkPageEvent(accountCode, { type: 'view' });
    await publicApi.linkPageSlugEvent(accountCode, 'expo', { type: 'click', linkType: 'link', position: 1 });
    expect((await failure(publicApi.linkPageSlugEvent(accountCode, 'nope', { type: 'view' }))).status).toBe(404);
    const rows = await db.all<{ payload: string }>(sql`SELECT payload FROM outbox WHERE kind = 'analytics' ORDER BY created_at`);
    const props = rows.map((r) => (JSON.parse(r.payload) as { properties: Record<string, unknown> }).properties);
    expect(props[0]).toMatchObject({ page_slug: 'main', page_is_default: true });
    expect(props[1]).toMatchObject({ page_slug: 'expo', page_id: expo.id, page_is_default: false, link_type: 'link' });
  });

  it('lets any member manage pages, and never reaches another workspace’s page', async () => {
    await db.run(
      sql`INSERT INTO member (id, account_id, email, handle, role, status, created_at)
          VALUES (${randomUUID()}, ${accountId}, ${'sam@acme.test'}, ${'sam'}, ${'member'}, ${'active'}, ${Date.now()})`,
    );
    const mine = await editor.create(asEmail('sam@acme.test'), { slug: 'sams-page' });
    expect(mine.slug).toBe('sams-page');

    const otherId = randomUUID();
    await db.run(sql`INSERT INTO account (id, code, name, created_at) VALUES (${otherId}, ${'other1'}, ${'Other'}, ${Date.now()})`);
    const theirs = randomUUID();
    await db.run(
      sql`INSERT INTO link_page (id, account_id, slug, name, config, is_default, created_at, updated_at)
          VALUES (${theirs}, ${otherId}, 'theirs', 'Theirs', ${'{"version":1,"enabled":true}'}, 1, 1, 1)`,
    );
    for (const call of [
      editor.one(asOwner(), theirs),
      editor.update(asOwner(), theirs, { name: 'Mine now' }),
      editor.duplicate(asOwner(), theirs, {}),
      editor.remove(asOwner(), theirs),
    ]) {
      expect((await failure(call)).status).toBe(404);
    }
    expect((await editor.list(asOwner())).pages.map((p) => p.id)).not.toContain(theirs);
    expect((await failure(publicApi.linkPageBySlug(accountCode, 'theirs'))).status).toBe(404);
    expect((await publicApi.linkPageBySlug('other1', 'theirs')).pageSlug).toBe('theirs');
  });
});
