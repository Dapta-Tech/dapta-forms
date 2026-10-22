/**
 * The workspace link page: the editor's read/write (`/v1/link-page`), the
 * public read (`GET /v1/public/pages/:accountCode`) and its analytics
 * (`POST /v1/public/pages/:accountCode/events`).
 *
 *   1. nothing is published by default: no page, and `enabled: false`, are 404;
 *   2. any member of the workspace can edit it, not only owners and admins;
 *   3. buttons keep their order, and a deleted form drops out silently;
 *   4. a form button naming another workspace's form is never stored;
 *   5. a view or click is enqueued only for a page that is live.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { createDb, getAccountByCode, migrate, seed, sql, type Db } from '@quill/db';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';
import { AnalyticsEffects } from './analytics-effects';
import { LinkPageController } from './link-page.controller';
import { LinkPageService } from './link-page.service';
import { PublicController } from './public.controller';
import { SubmissionService } from './submission.service';
import type { ServerEnv } from '@quill/config/env';
import { LINK_PAGE_LOGO_MAX_CHARS, LINK_PAGE_MAX_BODY_BYTES, LINK_PAGE_MAX_ITEMS } from '@quill/types';

let db: Db;
let editor: LinkPageController;
let publicApi: PublicController;
let accountId: string;
let accountCode: string;
let formIds: string[];

const asOwner = (): ReqLike => ({ headers: {} });
const asEmail = (email: string): ReqLike => ({ headers: { 'x-quill-email': email } });

async function addForm(account: string, slug: string, name: string): Promise<string> {
  const id = randomUUID();
  const now = Date.now() + formIds.length;
  await db.run(
    sql`INSERT INTO form (id, account_id, name, slug, config, created_at, updated_at)
        VALUES (${id}, ${account}, ${name}, ${slug}, ${'{"version":1,"steps":[]}'}, ${now}, ${now})`,
  );
  formIds.push(id);
  return id;
}

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (err) {
    if (err instanceof HttpException) return err.getStatus();
    throw err;
  }
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
  const account = (await getAccountByCode(db, 'acme'))!;
  accountId = account.id;
  accountCode = account.code;
  formIds = [];
  const provider = new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });
  const analytics = new AnalyticsEffects(db, { PRODUCT_ANALYTICS_KEY: 'phc_test' } as ServerEnv);
  const pages = new LinkPageService(db, analytics);
  editor = new LinkPageController(new AuthService(db, provider), pages);
  publicApi = new PublicController({} as SubmissionService, {} as never, undefined, pages);
});

afterEach(async () => {
  await db.close();
});

const analyticsRows = () =>
  db.all<{ action: string; payload: string }>(sql`SELECT action, payload FROM outbox WHERE kind = 'analytics'`);

describe('workspace link page', () => {
  it('is 404 until someone turns it on, and again once it is turned off', async () => {
    expect(await status(publicApi.linkPage(accountCode))).toBe(404);
    await editor.put(asOwner(), { page: { version: 1, enabled: false, bio: 'hi' } });
    expect(await status(publicApi.linkPage(accountCode))).toBe(404);
    await editor.put(asOwner(), { page: { version: 1, enabled: true } });
    expect(await status(publicApi.linkPage(accountCode))).toBe(200);
    await editor.put(asOwner(), { page: { version: 1, enabled: false } });
    expect(await status(publicApi.linkPage(accountCode))).toBe(404);
    expect(await status(publicApi.linkPage('no-such-workspace'))).toBe(404);
  });

  it('shows exactly the chosen forms and links, in the chosen order, and only the filled socials', async () => {
    const [a, b, c] = [await addForm(accountId, 'a', 'Form A'), await addForm(accountId, 'b', 'Form B'), await addForm(accountId, 'c', 'Form C')];
    await editor.put(asOwner(), {
      page: {
        version: 1,
        enabled: true,
        name: 'Acme',
        items: [
          { type: 'form', formId: c },
          { type: 'link', label: 'Store', url: 'https://shop.acme.example' },
          { type: 'form', formId: a },
          { type: 'link', label: 'Blog', url: 'https://blog.acme.example' },
          { type: 'form', formId: b },
        ],
        socials: { instagram: 'instagram.com/acme', tiktok: '@acme', x: '' },
      },
    });
    const page = await publicApi.linkPage(accountCode);
    expect(page.name).toBe('Acme');
    expect(page.buttons.map((x) => x.label)).toEqual(['Form C', 'Store', 'Form A', 'Blog', 'Form B']);
    expect(page.socials.map((s) => s.network)).toEqual(['instagram', 'tiktok']);
  });

  it('drops a deleted form silently instead of rendering a broken button', async () => {
    const a = await addForm(accountId, 'a', 'Form A');
    const b = await addForm(accountId, 'b', 'Form B');
    await editor.put(asOwner(), {
      page: { version: 1, enabled: true, items: [{ type: 'form', formId: a }, { type: 'form', formId: b }] },
    });
    await db.run(sql`DELETE FROM form WHERE id = ${a}`);
    const page = await publicApi.linkPage(accountCode);
    expect(page.buttons).toEqual([{ type: 'form', label: 'Form B', slug: 'b' }]);
  });

  it('never stores a button for another workspace’s form', async () => {
    const otherId = randomUUID();
    await db.run(
      sql`INSERT INTO account (id, code, name, created_at) VALUES (${otherId}, ${'other1'}, ${'Other'}, ${Date.now()})`,
    );
    const foreign = await addForm(otherId, 'theirs', 'Theirs');
    const own = await addForm(accountId, 'mine', 'Mine');
    const res = await editor.put(asOwner(), {
      page: { version: 1, enabled: true, items: [{ type: 'form', formId: foreign }, { type: 'form', formId: own }] },
    });
    expect(res.page?.items).toEqual([{ type: 'form', formId: own }]);
  });

  it('refuses an invalid page with a 400 that names the field', async () => {
    let body: unknown;
    try {
      await editor.put(asOwner(), { page: { version: 1, socials: { whatsapp: '123' } } });
    } catch (err) {
      body = (err as HttpException).getResponse();
    }
    expect(body).toMatchObject({ error: 'BAD_REQUEST' });
    expect(JSON.stringify(body)).toContain('socials.whatsapp');
  });

  it('saves a page at every limit the schema has (larger than 100 KB of JSON)', async () => {
    const page = {
      version: 1,
      enabled: true,
      name: 'N'.repeat(80),
      bio: 'B'.repeat(280),
      logo: `data:image/png;base64,${'A'.repeat(LINK_PAGE_LOGO_MAX_CHARS - 'data:image/png;base64,'.length)}`,
      items: Array.from({ length: LINK_PAGE_MAX_ITEMS }, (_, i) => ({
        type: 'link',
        label: `Link ${i}`.padEnd(80, '.'),
        url: `https://acme.example/${String(i).padStart(2, '0')}/${'p'.repeat(2048 - 'https://acme.example/00/'.length)}`,
      })),
      socials: { whatsapp: '+57 300 123 4567' },
    };
    const body = { page };
    expect(JSON.stringify(body).length).toBeGreaterThan(100 * 1024);
    expect(JSON.stringify(body).length).toBeLessThan(LINK_PAGE_MAX_BODY_BYTES);
    const res = await editor.put(asOwner(), body);
    expect(res.page?.items).toHaveLength(LINK_PAGE_MAX_ITEMS);
    expect((await publicApi.linkPage(accountCode)).buttons).toHaveLength(LINK_PAGE_MAX_ITEMS);
  });

  it('stores WhatsApp as digits and serves the wa.me link', async () => {
    const res = await editor.put(asOwner(), {
      page: { version: 1, enabled: true, socials: { whatsapp: '+57 300 123 4567' } },
    });
    expect(res.page?.socials?.whatsapp).toBe('573001234567');
    const page = await publicApi.linkPage(accountCode);
    expect(page.socials).toEqual([{ network: 'whatsapp', href: 'https://wa.me/573001234567' }]);
  });

  it('lets any member of the workspace edit it, not only owners and admins', async () => {
    await db.run(
      sql`INSERT INTO member (id, account_id, email, handle, role, status, created_at)
          VALUES (${randomUUID()}, ${accountId}, ${'sam@acme.test'}, ${'sam'}, ${'member'}, ${'active'}, ${Date.now()})`,
    );
    const res = await editor.put(asEmail('sam@acme.test'), { page: { version: 1, enabled: true, bio: 'From Sam' } });
    expect(res.ok).toBe(true);
    const view = await editor.get(asEmail('sam@acme.test'));
    expect(view.accountCode).toBe(accountCode);
    expect(view.page?.bio).toBe('From Sam');
  });

  it('hands the editor its forms and the stored page', async () => {
    const a = await addForm(accountId, 'a', 'Form A');
    const view = await editor.get(asOwner());
    expect(view.page).toBeNull();
    expect(view.forms.map((f) => f.id)).toContain(a);
  });

  it('enqueues a view and a click with link_type for a live page, and nothing for a dead one', async () => {
    expect(await status(publicApi.linkPageEvent(accountCode, { type: 'view' }))).toBe(404);
    expect(await analyticsRows()).toHaveLength(0);

    await editor.put(asOwner(), { page: { version: 1, enabled: true } });
    await publicApi.linkPageEvent(accountCode, { type: 'view' });
    await publicApi.linkPageEvent(accountCode, { type: 'click', linkType: 'social', network: 'instagram', position: 0 });
    const rows = await analyticsRows();
    expect(rows.map((r) => r.action)).toEqual(['forms_link_page_viewed', 'forms_link_page_clicked']);
    const click = JSON.parse(rows[1]!.payload) as { distinctId: string; properties: Record<string, unknown> };
    expect(click.distinctId).toBe(`account:${accountId}`);
    expect(click.properties).toMatchObject({ link_type: 'social', network: 'instagram', account_code: accountCode });

    expect(await status(publicApi.linkPageEvent(accountCode, { type: 'click', linkType: 'nope' }))).toBe(400);
  });
});
