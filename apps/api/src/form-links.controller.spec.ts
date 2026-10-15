/**
 * `publicUrl` and `editorUrl` on every form the admin API returns, through the
 * REAL admin controller on in-memory SQLite (same harness as
 * draft-publish.spec.ts).
 *
 * An agent hands these to a person verbatim, so the public one is checked the
 * way a visitor would use it: its path is fed to the same lookup the public
 * page calls, and it must land on the form. It is also checked against the
 * shared `publicFormPath`, the rule every web surface builds its links with.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { createDb, migrate, seed, getPublishedForm, setVanitySlug, sql, type Db } from '@quill/db';
import { formEditorPath, publicFormPath } from '@quill/shared';
import type { ServerEnv } from '@quill/config/env';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { AuthService } from './auth.service';
import { LocalAuthProvider } from './auth.provider';
import type { ReqLike } from './auth.provider';

const APP = 'https://forms.example.com';

let db: Db;
let formId: string;
let accountId: string;

/** No identity → local provider resolves the seeded demo owner. */
const asOwner = (): ReqLike => ({ headers: {} });

const CONFIG = {
  version: 1,
  steps: [{ key: 'work_email', type: 'email', question: 'Work email?', required: true }],
};

/** The controller as the app wires it, with `PUBLIC_APP_URL` set to `appUrl`. */
function controllerWith(appUrl: string | undefined): AdminCrudController {
  const provider = new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });
  const env = appUrl === undefined ? undefined : ({ PUBLIC_APP_URL: appUrl } as ServerEnv);
  return new AdminCrudController(
    db,
    new AuthService(db, provider),
    new AdminService(db),
    {} as never,
    {} as never,
    undefined,
    undefined,
    undefined,
    undefined,
    env,
  );
}

/**
 * Open a `publicUrl` the way the public page does: `/{accountCode}/{handle}/{slug}`,
 * resolved by account code and slug alone (the middle segment is never read).
 */
async function open(publicUrl: string | null) {
  expect(publicUrl).not.toBeNull();
  const url = new URL(publicUrl!);
  expect(url.origin).toBe(APP);
  const [accountCode, handle, slug, ...rest] = url.pathname.split('/').slice(1).map(decodeURIComponent);
  expect(rest).toEqual([]);
  expect(handle).toBe('f');
  return getPublishedForm(db, accountCode!, slug!);
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db); // account "acme" + demo form "lead-qualifier"
  const row = await db.get<{ id: string; account_id: string }>(
    sql`SELECT id, account_id FROM form WHERE slug = 'lead-qualifier' LIMIT 1`,
  );
  formId = row!.id;
  accountId = row!.account_id;
});

afterEach(async () => {
  await db.close();
});

describe('publicUrl / editorUrl on form responses', () => {
  it('GET /v1/forms/:id hands out the link the web builds, and it opens the published form', async () => {
    const c = controllerWith(APP);
    const form = await c.getForm(asOwner(), formId);

    expect(form.publicUrl).toBe(`${APP}${publicFormPath('acme', 'lead-qualifier')}`);
    expect(form.editorUrl).toBe(`${APP}${formEditorPath(formId)}`);
    expect(form.editorUrl).toBe(`${APP}/admin/forms/${formId}/edit`);

    await c.publishForm(asOwner(), formId);
    const opened = await open(form.publicUrl);
    expect(opened?.id).toBe(formId);
  });

  it('every form-returning route carries both links: create, list, update, duplicate, publish', async () => {
    const c = controllerWith(APP);

    const created = await c.createForm(asOwner(), { name: 'Spring launch', config: CONFIG });
    expect(created.publicUrl).toBe(`${APP}/acme/f/${created.slug}`);
    expect(created.editorUrl).toBe(`${APP}/admin/forms/${created.id}/edit`);
    expect((await open(created.publicUrl))?.id).toBe(created.id);

    const list = await c.listForms(asOwner());
    expect(list.length).toBeGreaterThanOrEqual(2);
    for (const item of list) {
      expect(item.publicUrl).toBe(`${APP}/acme/f/${item.slug}`);
      expect(item.editorUrl).toBe(`${APP}/admin/forms/${item.id}/edit`);
    }

    const updated = await c.updateForm(asOwner(), created.id, { name: 'Spring launch v2', config: CONFIG });
    expect(updated.publicUrl).toBe(created.publicUrl);
    expect(updated.editorUrl).toBe(created.editorUrl);

    const published = await c.publishForm(asOwner(), created.id);
    expect(published.publicUrl).toBe(created.publicUrl);
    expect(published.editorUrl).toBe(created.editorUrl);

    const copy = await c.duplicateForm(asOwner(), created.id);
    expect(copy.id).not.toBe(created.id);
    expect(copy.publicUrl).toBe(`${APP}/acme/f/${copy.slug}`);
    expect(copy.editorUrl).toBe(`${APP}/admin/forms/${copy.id}/edit`);
    expect((await open(copy.publicUrl))?.id).toBe(copy.id);
  });

  it('follows a slug rename, through the slug route and through the legacy `slug` field on PUT', async () => {
    const c = controllerWith(APP);

    const renamed = await c.updateFormSlug(asOwner(), formId, { slug: 'talk-to-sales' });
    expect(renamed.publicUrl).toBe(`${APP}/acme/f/talk-to-sales`);
    expect((await c.getForm(asOwner(), formId)).publicUrl).toBe(`${APP}/acme/f/talk-to-sales`);
    const opened = await open(renamed.publicUrl);
    expect(opened?.id).toBe(formId);
    expect(opened?.slug).toBe('talk-to-sales'); // the live slug, not a retired alias

    const again = await c.updateForm(asOwner(), formId, { slug: 'Book A Demo' });
    expect(again.publicUrl).toBe(`${APP}/acme/f/book-a-demo`);
    expect((await c.listForms(asOwner())).find((f) => f.id === formId)?.publicUrl).toBe(
      `${APP}/acme/f/book-a-demo`,
    );
  });

  it("names the workspace by its vanity slug once it claims one, as the web's links do", async () => {
    const c = controllerWith(APP);
    expect((await setVanitySlug(db, accountId, 'acme-labs')).ok).toBe(true);

    const form = await c.getForm(asOwner(), formId);
    expect(form.publicUrl).toBe(`${APP}/acme-labs/f/lead-qualifier`);
    expect((await open(form.publicUrl))?.id).toBe(formId);
  });

  it('a 409 STALE body carries both links on `current`, from PUT and from publish', async () => {
    const c = controllerWith(APP);
    const stale = (await c.getForm(asOwner(), formId)).updatedAt;
    await new Promise((r) => setTimeout(r, 2));
    await c.updateForm(asOwner(), formId, { config: CONFIG }); // someone else saved

    const currentOf = async (call: Promise<unknown>) => {
      const thrown = await call.then(
        () => null,
        (e: unknown) => e,
      );
      expect(thrown).toBeInstanceOf(ConflictException);
      const body = (thrown as ConflictException).getResponse() as { error: string; current: Record<string, unknown> };
      expect(body.error).toBe('STALE');
      return body.current;
    };
    const links = {
      id: formId,
      publicUrl: `${APP}/acme/f/lead-qualifier`,
      editorUrl: `${APP}/admin/forms/${formId}/edit`,
    };

    expect(await currentOf(c.updateForm(asOwner(), formId, { config: CONFIG, expectedUpdatedAt: stale }))).toMatchObject(
      links,
    );
    expect(await currentOf(c.publishForm(asOwner(), formId, { expectedUpdatedAt: stale }))).toMatchObject(links);
  });

  it('tolerates a trailing slash on PUBLIC_APP_URL', async () => {
    const form = await controllerWith(`${APP}/`).getForm(asOwner(), formId);
    expect(form.publicUrl).toBe(`${APP}/acme/f/lead-qualifier`);
    expect(form.editorUrl).toBe(`${APP}/admin/forms/${formId}/edit`);
  });

  it.each([
    ['empty', ''],
    ['not configured', undefined],
  ])('without PUBLIC_APP_URL (%s) both links are null and every route still answers', async (_label, appUrl) => {
    const c = controllerWith(appUrl);

    const got = await c.getForm(asOwner(), formId);
    expect(got.publicUrl).toBeNull();
    expect(got.editorUrl).toBeNull();
    expect(got.id).toBe(formId);

    const created = await c.createForm(asOwner(), { name: 'No base', config: CONFIG });
    expect(created).toMatchObject({ publicUrl: null, editorUrl: null });

    for (const item of await c.listForms(asOwner())) {
      expect(item).toMatchObject({ publicUrl: null, editorUrl: null });
    }
    expect(await c.updateForm(asOwner(), created.id, { config: CONFIG })).toMatchObject({
      publicUrl: null,
      editorUrl: null,
    });
    expect(await c.updateFormSlug(asOwner(), created.id, { slug: 'no-base-2' })).toMatchObject({
      publicUrl: null,
      editorUrl: null,
    });
    expect(await c.publishForm(asOwner(), created.id)).toMatchObject({ publicUrl: null, editorUrl: null });
    expect(await c.duplicateForm(asOwner(), created.id)).toMatchObject({ publicUrl: null, editorUrl: null });
  });
});
