/**
 * Draft → publish workflow through the REAL admin controller on in-memory
 * SQLite (same harness as members.controller.spec.ts):
 *
 *   1. PUT /v1/forms/:id with `config` stores an UNPUBLISHED draft — the live
 *      config (what the public renderer serves) is untouched;
 *   2. `name`/`slug` on the same PUT apply to the live row immediately
 *      (metadata is not part of the draft flow);
 *   3. POST /v1/forms/:id/publish copies the draft over the live config, stamps
 *      published_at, clears the draft — and the public surface serves it;
 *   4. publish with NO pending draft is an idempotent no-op.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { createDb, migrate, seed, getPublishedForm, sql, type Db } from '@quill/db';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { AuthService } from './auth.service';
import { LocalAuthProvider } from './auth.provider';
import type { ReqLike } from './auth.provider';

let db: Db;
let controller: AdminCrudController;
let formId: string;
let liveConfig: unknown;

/** No identity → local provider resolves the seeded demo owner. */
const asOwner = (): ReqLike => ({ headers: {} });

const DRAFT_CONFIG = {
  version: 1,
  steps: [{ key: 'work_email', type: 'email', question: 'Work email?', required: true }],
};

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
  // Submission/Analytics services are unused by the form routes under test.
  controller = new AdminCrudController(db, auth, admin, {} as never, {} as never);

  const row = await db.get<{ id: string }>(
    sql`SELECT id FROM form WHERE slug = 'lead-qualifier' LIMIT 1`,
  );
  formId = row!.id;
  liveConfig = (await controller.getForm(asOwner(), formId)).config;
});

afterEach(async () => {
  await db.close();
});

describe('PUT /v1/forms/:id (draft semantics)', () => {
  it('stores `config` as a draft; the live config and the public surface are untouched', async () => {
    const updated = await controller.updateForm(asOwner(), formId, { config: DRAFT_CONFIG });
    expect(updated.draftConfig).toEqual(DRAFT_CONFIG);
    expect(updated.config).toEqual(liveConfig); // live untouched

    // The public renderer path reads ONLY the live `config` column.
    const pub = await getPublishedForm(db, 'acme', 'lead-qualifier');
    expect(pub!.config).toEqual(liveConfig);
  });

  it('applies `name` to the live row immediately (metadata is not drafted)', async () => {
    const updated = await controller.updateForm(asOwner(), formId, {
      name: 'Renamed Qualifier',
      config: DRAFT_CONFIG,
    });
    expect(updated.name).toBe('Renamed Qualifier'); // live now
    expect(updated.config).toEqual(liveConfig); // config still staged
    expect(updated.draftConfig).toEqual(DRAFT_CONFIG);
  });
});

describe('POST /v1/forms/:id/publish', () => {
  it('copies the draft over the live config, stamps published_at, clears the draft', async () => {
    await controller.updateForm(asOwner(), formId, { config: DRAFT_CONFIG });

    const published = await controller.publishForm(asOwner(), formId);
    expect(published.config).toEqual(DRAFT_CONFIG); // draft went live
    expect(published.draftConfig == null).toBe(true); // cleared
    expect(published.publishedAt).not.toBeNull();

    // The public surface now serves the newly published config.
    const pub = await getPublishedForm(db, 'acme', 'lead-qualifier');
    expect(pub!.config).toEqual(DRAFT_CONFIG);
  });

  it('is a no-op when no draft is pending (idempotent)', async () => {
    const out = await controller.publishForm(asOwner(), formId);
    expect(out.config).toEqual(liveConfig); // unchanged
    expect(out.draftConfig == null).toBe(true);
    expect(out.publishedAt).toBeNull(); // never published via the draft flow

    const pub = await getPublishedForm(db, 'acme', 'lead-qualifier');
    expect(pub!.config).toEqual(liveConfig);
  });
});

/**
 * The optimistic lock on the editor's writes (PUT and publish). A 409 STALE
 * carries the row as it is now, so the client can compare content and either
 * adopt the new stamp silently or show the conflict.
 */
describe('expectedUpdatedAt (optimistic lock)', () => {
  const stampOf = async () => (await controller.getForm(asOwner(), formId)).updatedAt;
  const tick = () => new Promise((r) => setTimeout(r, 2));

  it('PUT with the current stamp lands and returns the new stamp', async () => {
    const before = await stampOf();
    await tick();
    const updated = await controller.updateForm(asOwner(), formId, {
      config: DRAFT_CONFIG,
      expectedUpdatedAt: before,
    });
    expect(updated.draftConfig).toEqual(DRAFT_CONFIG);
    expect(updated.updatedAt).toBeGreaterThan(before);
  });

  it('PUT with a stale stamp answers 409 STALE with the current row, and writes nothing', async () => {
    const before = await stampOf();
    await tick();
    await controller.updateForm(asOwner(), formId, { config: DRAFT_CONFIG }); // someone else
    const now = await stampOf();

    let thrown: unknown;
    try {
      await controller.updateForm(asOwner(), formId, {
        config: { ...DRAFT_CONFIG, steps: [] },
        expectedUpdatedAt: before,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ConflictException);
    const body = (thrown as ConflictException).getResponse() as Record<string, unknown>;
    expect(body.error).toBe('STALE');
    expect(body.updatedAt).toBe(now);
    expect((body.current as { draftConfig: unknown }).draftConfig).toEqual(DRAFT_CONFIG);
    expect((await controller.getForm(asOwner(), formId)).draftConfig).toEqual(DRAFT_CONFIG);
  });

  it('name + config on one PUT: the draft write checks the stamp the rename just produced', async () => {
    const before = await stampOf();
    await tick();
    const updated = await controller.updateForm(asOwner(), formId, {
      name: 'Both at once',
      config: DRAFT_CONFIG,
      expectedUpdatedAt: before,
    });
    expect(updated.name).toBe('Both at once');
    expect(updated.draftConfig).toEqual(DRAFT_CONFIG);
  });

  it('publish with a stale stamp answers 409 STALE and leaves the draft pending', async () => {
    const before = await stampOf();
    await tick();
    await controller.updateForm(asOwner(), formId, { config: DRAFT_CONFIG });
    await expect(
      controller.publishForm(asOwner(), formId, { expectedUpdatedAt: before }),
    ).rejects.toBeInstanceOf(ConflictException);
    const row = await controller.getForm(asOwner(), formId);
    expect(row.draftConfig).toEqual(DRAFT_CONFIG);
    expect(row.publishedAt).toBeNull();
  });

  it('publish with the current stamp goes live', async () => {
    await controller.updateForm(asOwner(), formId, { config: DRAFT_CONFIG });
    const published = await controller.publishForm(asOwner(), formId, {
      expectedUpdatedAt: await stampOf(),
    });
    expect(published.config).toEqual(DRAFT_CONFIG);
    expect(published.draftConfig == null).toBe(true);
  });

  it('a body without the stamp is the old unguarded behavior', async () => {
    await controller.updateForm(asOwner(), formId, { config: DRAFT_CONFIG });
    await tick();
    await controller.updateForm(asOwner(), formId, { config: DRAFT_CONFIG }); // stamp moved
    const published = await controller.publishForm(asOwner(), formId);
    expect(published.config).toEqual(DRAFT_CONFIG);
  });
});
