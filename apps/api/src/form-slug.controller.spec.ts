/**
 * PUT /v1/forms/:id/slug through the REAL admin controller on in-memory SQLite
 * (same harness as draft-publish.spec.ts).
 *
 * The data layer's own guarantees are covered in `packages/db/src/form-slug.spec.ts`.
 * What this pins is the HTTP contract the builder's rename dialog is written
 * against: a 409 whose `error` says WHICH refusal it was, so the dialog can put
 * a specific sentence on screen instead of a generic failure, and the promise
 * that the legacy `slug` field on the plain form PUT retires the old value too
 * rather than quietly dropping it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { createDb, migrate, seed, getPublishedForm, sql, type Db } from '@quill/db';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { AuthService } from './auth.service';
import { LocalAuthProvider } from './auth.provider';
import type { ReqLike } from './auth.provider';

let db: Db;
let controller: AdminCrudController;
let formId: string;

/** No identity → local provider resolves the seeded demo owner. */
const asOwner = (): ReqLike => ({ headers: {} });

/** The `error` code carried by a 409 body, for the dialog to branch on. */
async function conflictCode(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (e) {
    if (e instanceof ConflictException) {
      return (e.getResponse() as { error?: string }).error ?? '';
    }
    throw e;
  }
  throw new Error('expected a ConflictException');
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db); // account "acme" + demo form "lead-qualifier"
  const provider = new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });
  const auth = new AuthService(db, provider);
  const admin = new AdminService(db);
  controller = new AdminCrudController(db, auth, admin, {} as never, {} as never);

  const row = await db.get<{ id: string }>(sql`SELECT id FROM form WHERE slug = 'lead-qualifier' LIMIT 1`);
  formId = row!.id;
});

afterEach(async () => {
  await db.close();
});

describe('PUT /v1/forms/:id/slug', () => {
  it('renames the live form and keeps the previous link resolving', async () => {
    const updated = await controller.updateFormSlug(asOwner(), formId, { slug: 'talk-to-sales' });
    expect(updated.slug).toBe('talk-to-sales');

    expect((await getPublishedForm(db, 'acme', 'talk-to-sales'))!.id).toBe(formId);
    // The old link still answers, and reports the canonical slug so the public
    // page knows to send the visitor on rather than serve two addresses.
    expect((await getPublishedForm(db, 'acme', 'lead-qualifier'))!.slug).toBe('talk-to-sales');
  });

  it('409s with SLUG_TAKEN when another form already holds it', async () => {
    const other = await controller.createForm(asOwner(), { name: 'Pricing' });

    expect(await conflictCode(controller.updateFormSlug(asOwner(), formId, { slug: other.slug }))).toBe(
      'SLUG_TAKEN',
    );
  });

  it('409s with SLUG_INVALID on a malformed slug', async () => {
    expect(await conflictCode(controller.updateFormSlug(asOwner(), formId, { slug: 'Talk To Sales' }))).toBe(
      'SLUG_INVALID',
    );
  });

  it('404s for a form id this account does not own', async () => {
    await expect(controller.updateFormSlug(asOwner(), 'no-such-form', { slug: 'anything' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects an empty body before it reaches the data layer', async () => {
    await expect(controller.updateFormSlug(asOwner(), formId, {})).rejects.toBeTruthy();
    // The form is untouched: a 400 must not be a partial rename.
    expect((await controller.getForm(asOwner(), formId)).slug).toBe('lead-qualifier');
  });

  it('never leaves a webhook secret in the response', async () => {
    // Every other form-returning route masks; this one returns a form too, so
    // it has to be on the same list rather than the one exception nobody checks.
    const updated = await controller.updateFormSlug(asOwner(), formId, { slug: 'masked-check' });
    expect(JSON.stringify(updated)).not.toContain('"secret":"');
  });
});

describe('PUT /v1/forms/:id with a `slug` field', () => {
  it('retires the previous slug exactly as the dedicated route does', async () => {
    // This field predates the rename feature, so an API-key integration may
    // still be sending it. It must not be the one door that breaks links.
    await controller.updateForm(asOwner(), formId, { slug: 'legacy-path' });

    expect((await getPublishedForm(db, 'acme', 'legacy-path'))!.id).toBe(formId);
    expect((await getPublishedForm(db, 'acme', 'lead-qualifier'))!.slug).toBe('legacy-path');
  });

  it('applies a name and a slug in the same call', async () => {
    const updated = await controller.updateForm(asOwner(), formId, { name: 'Talk to sales', slug: 'talk-to-sales' });

    expect(updated).toMatchObject({ name: 'Talk to sales', slug: 'talk-to-sales' });
  });

  it('still SLUGIFIES rather than rejecting, unlike the dedicated route', async () => {
    // The lenient contract this endpoint shipped with. Tightening it would
    // break the integrations the field is being kept for, and the whole point
    // of keeping it is that they do not have to change.
    const updated = await controller.updateForm(asOwner(), formId, { slug: 'Talk To Sales' });
    expect(updated.slug).toBe('talk-to-sales');

    // The dedicated route, which a person types into, refuses the same value.
    expect(await conflictCode(controller.updateFormSlug(asOwner(), formId, { slug: 'Talk To Sales' }))).toBe(
      'SLUG_INVALID',
    );
  });

  it('leaves name AND config untouched when the slug is refused', async () => {
    // The three writes are not a transaction, so the refusable one runs first.
    // Applying `name` before the slug clash meant a 409 that renamed the form
    // and silently dropped the config draft: a request that reports failure and
    // changes the form anyway.
    const other = await controller.createForm(asOwner(), { name: 'Pricing' });
    const before = await controller.getForm(asOwner(), formId);

    await expect(
      controller.updateForm(asOwner(), formId, {
        name: 'Should not stick',
        slug: other.slug,
        config: { version: 1, steps: [{ key: 'x', type: 'text', question: 'Should not stick?' }] },
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const after = await controller.getForm(asOwner(), formId);
    expect(after.name).toBe(before.name);
    expect(after.slug).toBe(before.slug);
    expect(after.draftConfig ?? null).toEqual(before.draftConfig ?? null);
  });
});
