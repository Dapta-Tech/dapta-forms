/**
 * POST /v1/forms/:id/revert through the REAL admin controller on in-memory
 * SQLite (same harness as draft-publish.spec.ts):
 *
 *   1. publish A, publish B, revert: A is live (and the public surface serves
 *      it the moment the call returns), B is the previous; revert again: B;
 *   2. destinations stay as they are now: a webhook connected after A went
 *      live survives a revert to A, and its secret stays masked in the answer;
 *   3. a pending draft is untouched;
 *   4. nothing to go back to: 409 NOTHING_TO_REVERT, and nothing changes;
 *   5. an API key may call it (the agent that broke a form is the first one
 *      that wants to roll it back).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { createDb, migrate, seed, getPublishedForm, updateFormDestinations, sql, type Db } from '@quill/db';
import { WEBHOOK_SECRET_MASK } from '@quill/types';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { AuthService } from './auth.service';
import { LocalAuthProvider } from './auth.provider';
import type { HostPrincipal, ReqLike } from './auth.provider';

let db: Db;
let auth: AuthService;
let controller: AdminCrudController;
let formId: string;
let bornConfig: unknown;

/** No identity → local provider resolves the seeded demo owner. */
const asOwner = (): ReqLike => ({ headers: {} });

const cfg = (question: string) => ({
  version: 1,
  steps: [{ key: 'work_email', type: 'email', question, required: true }],
});

const HOOK = {
  id: 'hook-1',
  type: 'webhook',
  enabled: true,
  settings: { url: 'https://hooks.example.com/in', secret: 'whsec_plaintext' },
};

const tick = () => new Promise((r) => setTimeout(r, 2));

/** Stage a draft through the editor's own route and publish it. */
async function publish(question: string) {
  await tick(); // one millisecond per publish, so the dates tell versions apart
  await controller.updateForm(asOwner(), formId, { config: cfg(question) });
  return controller.publishForm(asOwner(), formId);
}

/** What the public renderer serves right now. */
async function publicConfig(): Promise<unknown> {
  return (await getPublishedForm(db, 'acme', 'lead-qualifier'))!.config;
}

/** The thrown response body of a refused call. */
async function refusal(call: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await call;
  } catch (e) {
    if (e instanceof ConflictException || e instanceof NotFoundException) {
      return { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> };
    }
    throw e;
  }
  throw new Error('expected the call to be refused');
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
  auth = new AuthService(db, provider);
  const admin = new AdminService(db);
  // Submission/Analytics services are unused by the form routes under test.
  controller = new AdminCrudController(db, auth, admin, {} as never, {} as never);

  const row = await db.get<{ id: string }>(sql`SELECT id FROM form WHERE slug = 'lead-qualifier' LIMIT 1`);
  formId = row!.id;
  bornConfig = (await controller.getForm(asOwner(), formId)).config;
});

afterEach(async () => {
  await db.close();
});

describe('POST /v1/forms/:id/revert', () => {
  it('publish A, publish B, revert: A is live and B is the previous; revert again: B is live', async () => {
    const a = await publish('A?');
    const b = await publish('B?');
    expect(b.previousPublishedAt).toBe(a.publishedAt);

    const first = await controller.revertForm(asOwner(), formId);
    expect(first.config).toEqual(cfg('A?'));
    expect(first.publishedAt).toBe(a.publishedAt);
    expect(first.previousPublishedAt).toBe(b.publishedAt);
    // Served publicly as soon as the call returns.
    expect(await publicConfig()).toEqual(cfg('A?'));

    const second = await controller.revertForm(asOwner(), formId);
    expect(second.config).toEqual(cfg('B?'));
    expect(second.previousPublishedAt).toBe(a.publishedAt);
    expect(await publicConfig()).toEqual(cfg('B?'));
  });

  it('the first publish can be reverted to the config the form had before it', async () => {
    await publish('A?');
    const out = await controller.revertForm(asOwner(), formId);
    expect(out.config).toEqual(bornConfig);
    expect(await publicConfig()).toEqual(bornConfig);
  });

  it('a webhook configured after publishing A is still there after reverting to A', async () => {
    await publish('A?');
    const hooked = await updateFormDestinations(db, (await auth.resolveHost(asOwner())).accountId, formId, [HOOK]);
    expect(hooked.ok).toBe(true);
    await publish('B?');

    const out = await controller.revertForm(asOwner(), formId);
    const destinations = (out.config as { destinations?: Array<Record<string, unknown>> }).destinations;
    expect(destinations).toHaveLength(1);
    expect(destinations![0]).toMatchObject({ id: 'hook-1', settings: { url: 'https://hooks.example.com/in' } });
    // Like every form response, the secret leaves masked.
    expect((destinations![0]!.settings as { secret: string }).secret).toBe(WEBHOOK_SECRET_MASK);
    // And the live row still has it, so the webhook keeps signing.
    const live = (await publicConfig()) as { destinations?: Array<{ settings: { secret?: string } }> };
    expect(live.destinations?.[0]?.settings.secret).toBe('whsec_plaintext');
  });

  it('a pending draft is the same after the revert', async () => {
    await publish('A?');
    await publish('B?');
    await controller.updateForm(asOwner(), formId, { config: cfg('Draft?') });

    const out = await controller.revertForm(asOwner(), formId);
    expect(out.config).toEqual(cfg('A?'));
    expect(out.draftConfig).toEqual(cfg('Draft?'));
    expect((await controller.getForm(asOwner(), formId)).draftConfig).toEqual(cfg('Draft?'));
  });

  it('with no earlier publication answers 409 NOTHING_TO_REVERT and changes nothing', async () => {
    const before = await controller.getForm(asOwner(), formId);
    expect(before.previousPublishedAt).toBeNull();

    const { status, body } = await refusal(controller.revertForm(asOwner(), formId));
    expect(status).toBe(409);
    expect(body.error).toBe('NOTHING_TO_REVERT');
    expect(typeof body.message).toBe('string');
    expect(await controller.getForm(asOwner(), formId)).toEqual(before);
  });

  it('answers 404 for a form that is not in the workspace', async () => {
    const { status, body } = await refusal(controller.revertForm(asOwner(), 'no-such-form'));
    expect(status).toBe(404);
    expect(body.error).toBe('NOT_FOUND');
  });

  it('is allowed with an API key', async () => {
    await publish('A?');
    await publish('B?');
    const owner = await auth.resolveHost(asOwner());
    const keyed = {
      resolveHost: async (): Promise<HostPrincipal> => ({ ...owner, via: 'api_key', apiKeyId: 'key_1' }),
    } as unknown as AuthService;
    const viaKey = new AdminCrudController(db, keyed, new AdminService(db), {} as never, {} as never);

    const out = await viaKey.revertForm(asOwner(), formId);
    expect(out.config).toEqual(cfg('A?'));
    expect(await publicConfig()).toEqual(cfg('A?'));
  });
});

describe('previousPublishedAt on form responses', () => {
  it('is null before any publish and the previous version\'s date after one', async () => {
    expect((await controller.getForm(asOwner(), formId)).previousPublishedAt).toBeNull();
    const a = await publish('A?');
    const b = await publish('B?');
    expect(b.previousPublishedAt).toBe(a.publishedAt);
    expect((await controller.getForm(asOwner(), formId)).previousPublishedAt).toBe(a.publishedAt);
  });
});
