/**
 * API keys end to end (public API v1), through the real controllers, the real
 * `AuthService` and the local provider, on in-memory SQLite:
 *
 *   - create, list and revoke by role (member vs owner and admin) and workspace;
 *   - the key in clear only in the POST response, only its hash in the DB;
 *   - `Authorization: Bearer dforms_...` resolves to the key's member with the
 *     CURRENT role and `via: 'api_key'`; a revoked key, or a member who is no
 *     longer active, is a 401 `INVALID_API_KEY`; another workspace is a 403;
 *   - with a key, `POST /v1/forms` and duplicate write `created_via = 'api'` and
 *     the events say `via: 'api'` (a session says `web`);
 *   - the 121st call inside the minute is a 429 with `Retry-After`;
 *   - `last_used_at_ms` moves at most once a minute.
 *
 * The route allowlist (403 `KEY_NOT_ALLOWED`) has its own spec,
 * api-key-routes.spec.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import {
  createDb,
  migrate,
  seed,
  getAccountByCode,
  insertAccountWithShortCode,
  listOutbox,
  sql,
  type Db,
} from '@quill/db';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { AnalyticsEffects } from './analytics-effects';
import { ApiKeysController } from './api-keys.controller';
import { createApiKeyRateLimiter, API_KEY_CALLS_PER_MINUTE } from './api-key-auth';
import { hashApiKey } from './api-keys';
import { AuthService, WORKSPACE_HEADER } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';

const ANALYTICS_ON = { PRODUCT_ANALYTICS_KEY: 'phc_test', PRODUCT_ANALYTICS_HOST: 'https://x.test' };

let db: Db;
let clock: number;
let auth: AuthService;
let keys: ApiKeysController;
let crud: AdminCrudController;
let accountId: string;
let ownerId: string;
let adminId: string;
let bobId: string;
let carolId: string;

/** A session as one member of one account (the local provider's explicit impersonation). */
const as = (memberId: string, account = accountId): ReqLike => ({
  headers: { 'x-quill-account': account, 'x-quill-member': memberId },
});

/** A request with an API key; `headers` records what the handler set on the response. */
function withKey(key: string, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = {};
  const req = {
    headers: { authorization: `Bearer ${key}`, ...extra },
    res: { setHeader: (k: string, v: string) => (headers[k] = v) },
  };
  return { req: req as ReqLike, headers };
}

async function addMember(email: string, role: string, account = accountId, status = 'active') {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO member (id, account_id, email, display_name, role, status, created_at)
        VALUES (${id}, ${account}, ${email}, ${email.split('@')[0]!}, ${role}, ${status}, ${Date.now()})`,
  );
  return id;
}

async function captured(): Promise<{ event: string; props: Record<string, unknown> }[]> {
  return (await listOutbox(db, { kind: 'analytics' })).map((r) => {
    const p = JSON.parse(String(r.payload)) as { event: string; properties?: Record<string, unknown> };
    return { event: p.event, props: p.properties ?? {} };
  });
}

async function expectError(p: Promise<unknown>, type: new (...a: never[]) => HttpException, error: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(type);
  expect((err as HttpException).getResponse()).toMatchObject({ error });
  return err as HttpException;
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
  clock = 1_000_000;
  accountId = (await getAccountByCode(db, 'acme'))!.id;
  ownerId = (await db.get<{ id: string }>(
    sql`SELECT id FROM member WHERE account_id = ${accountId} AND role = 'owner' LIMIT 1`,
  ))!.id;
  adminId = await addMember('ada@example.com', 'admin');
  bobId = await addMember('bob@example.com', 'member');
  carolId = await addMember('carol@example.com', 'member');

  const provider = new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });
  const productAnalytics = new AnalyticsEffects(db, ANALYTICS_ON as never);
  auth = new AuthService(db, provider, undefined, createApiKeyRateLimiter(undefined, () => clock));
  keys = new ApiKeysController(db, auth, productAnalytics);
  crud = new AdminCrudController(
    db,
    auth,
    new AdminService(db),
    {} as never,
    {} as never,
    undefined,
    productAnalytics,
  );
});

afterEach(async () => {
  await db.close();
});

describe('POST /v1/api-keys', () => {
  it('returns the key in clear once, and stores only its hash', async () => {
    const created = await keys.create(as(bobId), { name: '  Claude Code  ' });
    expect(created).toMatchObject({ name: 'Claude Code', last4: created.key.slice(-4) });
    expect(Object.keys(created).sort()).toEqual(['createdAt', 'id', 'key', 'last4', 'name']);
    expect(created.key).toMatch(/^dforms_[A-Za-z0-9_-]{43}$/);

    const row = (await db.get<Record<string, unknown>>(sql`SELECT * FROM api_key WHERE id = ${created.id}`))!;
    expect(row.key_hash).toBe(hashApiKey(created.key));
    expect(row.prefix).toBe(created.key.slice(0, 12));
    expect(row.member_id).toBe(bobId);
    expect(row.account_id).toBe(accountId);
    expect(JSON.stringify(row)).not.toContain(created.key);

    // Never again: the list carries no key, no hash.
    const listed = JSON.stringify(await keys.list(as(bobId)));
    expect(listed).not.toContain(created.key);
    expect(listed).not.toContain(String(row.key_hash));
  });

  it('emits api_key_created for the member who made it', async () => {
    const created = await keys.create(as(bobId), { name: 'n8n' });
    const events = await captured();
    expect(events).toContainEqual({
      event: 'forms_api_key_created',
      props: { api_key_id: created.id, role: 'member' },
    });
  });

  it('marks api_key_created as staff access when staff create the key through a grant', async () => {
    const staffAuth = {
      resolveHost: async () => ({ accountId, memberId: adminId, role: 'admin' as const, via: 'session' as const, accessGrant: 'staff' as const }),
    } as unknown as AuthService;
    const analytics = (keys as unknown as { productAnalytics: AnalyticsEffects }).productAnalytics;
    const staffKeys = new ApiKeysController(db, staffAuth, analytics);
    const created = await staffKeys.create(as(adminId), { name: 'support' });
    expect(await captured()).toContainEqual({
      event: 'forms_api_key_created',
      props: { api_key_id: created.id, role: 'admin', staff_access: true },
    });
  });

  it('validates the name: 1 to 60 characters', async () => {
    await expectError(keys.create(as(bobId), {}), BadRequestException, 'BAD_REQUEST');
    await expectError(keys.create(as(bobId), { name: '   ' }), BadRequestException, 'BAD_REQUEST');
    await expectError(keys.create(as(bobId), { name: 'x'.repeat(61) }), BadRequestException, 'BAD_REQUEST');
    expect((await keys.create(as(bobId), { name: 'x'.repeat(60) })).name).toHaveLength(60);
  });

  it('the 11th active key of one person in one workspace is a 409 KEY_LIMIT', async () => {
    for (let i = 0; i < 10; i++) await keys.create(as(bobId), { name: `k${i}` });
    await expectError(keys.create(as(bobId), { name: 'one more' }), ConflictException, 'KEY_LIMIT');
    // Carol's ten are her own.
    await keys.create(as(carolId), { name: 'carol' });
    // Revoking frees a slot.
    const [first] = (await keys.list(as(bobId))).keys;
    await keys.revoke(as(bobId), first!.id);
    await keys.create(as(bobId), { name: 'again' });
  });
});

describe('GET /v1/api-keys', () => {
  it('a member sees their own keys; owner and admin see every active key with who created it', async () => {
    const b = await keys.create(as(bobId), { name: 'bob key' });
    await keys.create(as(carolId), { name: 'carol key' });
    const gone = await keys.create(as(carolId), { name: 'revoked' });
    await keys.revoke(as(carolId), gone.id);

    const bobs = (await keys.list(as(bobId))).keys;
    expect(bobs.map((k) => k.name)).toEqual(['bob key']);
    expect(bobs[0]).toEqual({
      id: b.id,
      name: 'bob key',
      last4: b.last4,
      createdAt: b.createdAt,
      lastUsedAt: null,
      createdBy: { memberId: bobId, name: 'bob', email: 'bob@example.com', staff: false },
    });

    for (const viewer of [ownerId, adminId]) {
      const all = (await keys.list(as(viewer))).keys.map((k) => k.name).sort();
      expect(all).toEqual(['bob key', 'carol key']);
    }
  });

  it("never lists another workspace's keys", async () => {
    await insertAccountWithShortCode(db, { name: 'Beta', externalId: 'ext:beta' });
    const beta = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE external_id = 'ext:beta'`))!.id;
    const betaOwner = await addMember('bea@example.com', 'owner', beta);
    await keys.create(as(betaOwner, beta), { name: 'beta key' });
    await keys.create(as(bobId), { name: 'acme key' });

    expect((await keys.list(as(ownerId))).keys.map((k) => k.name)).toEqual(['acme key']);
    expect((await keys.list(as(betaOwner, beta))).keys.map((k) => k.name)).toEqual(['beta key']);
  });
});

describe('DELETE /v1/api-keys/:id', () => {
  it("a member revokes their own key, not someone else's (403)", async () => {
    const carols = await keys.create(as(carolId), { name: 'carol' });
    await expectError(keys.revoke(as(bobId), carols.id), ForbiddenException, 'FORBIDDEN');
    expect((await keys.list(as(carolId))).keys).toHaveLength(1);
    await keys.revoke(as(carolId), carols.id);
    expect((await keys.list(as(carolId))).keys).toHaveLength(0);
  });

  it('owner and admin revoke any key of the workspace', async () => {
    const a = await keys.create(as(bobId), { name: 'a' });
    const b = await keys.create(as(carolId), { name: 'b' });
    await keys.revoke(as(adminId), a.id);
    await keys.revoke(as(ownerId), b.id);
    expect((await keys.list(as(ownerId))).keys).toHaveLength(0);
  });

  it("is a 404 for an unknown, already revoked, or other workspace's key", async () => {
    await expectError(keys.revoke(as(ownerId), 'nope'), NotFoundException, 'NOT_FOUND');
    const k = await keys.create(as(bobId), { name: 'k' });
    await keys.revoke(as(bobId), k.id);
    await expectError(keys.revoke(as(bobId), k.id), NotFoundException, 'NOT_FOUND');

    await insertAccountWithShortCode(db, { name: 'Beta', externalId: 'ext:beta2' });
    const beta = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE external_id = 'ext:beta2'`))!.id;
    const betaOwner = await addMember('bea@example.com', 'owner', beta);
    const theirs = await keys.create(as(betaOwner, beta), { name: 'theirs' });
    await expectError(keys.revoke(as(ownerId), theirs.id), NotFoundException, 'NOT_FOUND');
  });

  it('the key routes refuse a key, even called directly', async () => {
    const { key } = await keys.create(as(ownerId), { name: 'k' });
    await expectError(keys.list(withKey(key).req), ForbiddenException, 'KEY_NOT_ALLOWED');
    await expectError(keys.create(withKey(key).req, { name: 'x' }), ForbiddenException, 'KEY_NOT_ALLOWED');
  });
});

describe('Authorization: Bearer dforms_...', () => {
  it("resolves to the key's member and workspace, with the CURRENT role and via api_key", async () => {
    const created = await keys.create(as(bobId), { name: 'agent' });
    expect(await auth.resolveHost(withKey(created.key).req)).toEqual({
      accountId,
      memberId: bobId,
      role: 'member',
      via: 'api_key',
      apiKeyId: created.id,
    });
    await db.run(sql`UPDATE member SET role = 'admin' WHERE id = ${bobId}`);
    expect((await auth.resolveHost(withKey(created.key).req)).role).toBe('admin');
  });

  it('a session bearer that is not a key still goes to the provider', async () => {
    const p = await auth.resolveHost({ headers: { ...as(bobId).headers, authorization: 'Bearer eyJ.session' } });
    expect(p).toMatchObject({ memberId: bobId, via: 'session' });
  });

  it('an unknown key is a 401 INVALID_API_KEY', async () => {
    await expectError(
      auth.resolveHost(withKey('dforms_' + 'A'.repeat(43)).req),
      UnauthorizedException,
      'INVALID_API_KEY',
    );
  });

  it('a revoked key is a 401 on the very next call', async () => {
    const k = await keys.create(as(bobId), { name: 'agent' });
    await crud.listForms(withKey(k.key).req);
    await keys.revoke(as(bobId), k.id);
    await expectError(crud.listForms(withKey(k.key).req), UnauthorizedException, 'INVALID_API_KEY');
  });

  it('a key stops working when its member is disabled or removed', async () => {
    const bobs = await keys.create(as(bobId), { name: 'bob' });
    const carols = await keys.create(as(carolId), { name: 'carol' });
    await crud.listForms(withKey(bobs.key).req);

    await db.run(sql`UPDATE member SET status = 'disabled' WHERE id = ${bobId}`);
    await expectError(crud.listForms(withKey(bobs.key).req), UnauthorizedException, 'INVALID_API_KEY');

    await crud.removeMember(as(ownerId), carolId);
    await expectError(crud.listForms(withKey(carols.key).req), UnauthorizedException, 'INVALID_API_KEY');
  });

  it('disabling or removing a member revokes their keys for good; reactivating does not revive them', async () => {
    const bobs = await keys.create(as(bobId), { name: 'bob' });
    const carols = await keys.create(as(carolId), { name: 'carol' });
    const owners = await keys.create(as(ownerId), { name: 'owner' });

    await crud.updateMember(as(ownerId), bobId, { status: 'disabled' });
    await crud.removeMember(as(ownerId), carolId);
    const revoked = await db.all<{ member_id: string; revoked_at_ms: number | null }>(
      sql`SELECT member_id, revoked_at_ms FROM api_key WHERE id IN (${bobs.id}, ${carols.id}, ${owners.id})`,
    );
    expect(Object.fromEntries(revoked.map((r) => [r.member_id, r.revoked_at_ms != null]))).toEqual({
      [bobId]: true,
      [carolId]: true,
      [ownerId]: false,
    });
    expect((await keys.list(as(ownerId))).keys.map((k) => k.name)).toEqual(['owner']);

    await crud.updateMember(as(ownerId), bobId, { status: 'active' });
    await expectError(crud.listForms(withKey(bobs.key).req), UnauthorizedException, 'INVALID_API_KEY');
    expect((await keys.list(as(bobId))).keys).toEqual([]);
    expect((await keys.list(as(ownerId))).keys.map((k) => k.name)).toEqual(['owner']);
    await expect(crud.listForms(withKey(owners.key).req)).resolves.toBeTruthy();
  });

  it('GET /v1/api-keys never lists the keys of a member who is not active', async () => {
    // A row disabled behind the members API's back (an older deployment, a
    // manual fix) still has its keys unrevoked: the list hides them anyway.
    await keys.create(as(bobId), { name: 'bob' });
    await keys.create(as(carolId), { name: 'carol' });
    await db.run(sql`UPDATE member SET status = 'disabled' WHERE id = ${bobId}`);
    expect((await keys.list(as(ownerId))).keys.map((k) => k.name)).toEqual(['carol']);
  });

  it("the key fixes the workspace: another x-quill-workspace is a 403, its own is fine", async () => {
    const k = await keys.create(as(bobId), { name: 'agent' });
    await expectError(
      crud.listForms(withKey(k.key, { [WORKSPACE_HEADER]: randomUUID() }).req),
      ForbiddenException,
      'WORKSPACE_FORBIDDEN',
    );
    await crud.listForms(withKey(k.key, { [WORKSPACE_HEADER]: accountId }).req);
  });
});

describe('created_via and the via property', () => {
  const viaOf = async (id: string) =>
    (await db.get<{ created_via: string | null }>(sql`SELECT created_via FROM form WHERE id = ${id}`))!
      .created_via;

  it("with a key, POST /v1/forms writes created_via 'api' and form_created says via 'api'", async () => {
    const k = await keys.create(as(bobId), { name: 'agent' });
    const form = await crud.createForm(withKey(k.key).req, { name: 'From the agent' });
    expect(await viaOf(form.id)).toBe('api');
    expect(await captured()).toContainEqual({
      event: 'forms_form_created',
      props: { form_id: form.id, via: 'api' },
    });

    const copy = await crud.duplicateForm(withKey(k.key).req, form.id);
    expect(await viaOf(copy.id)).toBe('api');
    expect((await captured()).find((e) => e.props.form_id === copy.id)?.props).toMatchObject({
      from_duplicate: true,
      via: 'api',
    });
  });

  it("with a session, created_via is 'web' and the events say via 'web'", async () => {
    const form = await crud.createForm(as(bobId), { name: 'By hand' });
    expect(await viaOf(form.id)).toBe('web');
    const copy = await crud.duplicateForm(as(bobId), form.id);
    expect(await viaOf(copy.id)).toBe('web');
    const created = (await captured()).filter((e) => e.event === 'forms_form_created');
    expect(created.map((e) => e.props.via)).toEqual(['web', 'web']);
  });

  it("form_published carries the publisher's via", async () => {
    const k = await keys.create(as(bobId), { name: 'agent' });
    const form = await crud.createForm(as(bobId), { name: 'Publish me' });
    await crud.updateForm(withKey(k.key).req, form.id, { config: { version: 1, steps: [] } });
    await crud.publishForm(withKey(k.key).req, form.id);
    await crud.updateForm(as(bobId), form.id, { config: { version: 1, steps: [] } });
    await crud.publishForm(as(bobId), form.id);
    const published = (await captured()).filter((e) => e.event === 'forms_form_published');
    expect(published.map((e) => e.props.via)).toEqual(['api', 'web']);
  });
});

describe('rate limit: 120 calls a minute per key', () => {
  it('the 121st call inside the minute is a 429 RATE_LIMITED with Retry-After', async () => {
    const k = await keys.create(as(bobId), { name: 'agent' });
    // Back to back: the public limiter is a token bucket (a burst of 120,
    // refilled at 120 a minute), so the 121st call in a row is refused.
    for (let i = 0; i < API_KEY_CALLS_PER_MINUTE; i++) {
      await auth.resolveHost(withKey(k.key).req);
    }
    const call = withKey(k.key);
    const err = await expectError(auth.resolveHost(call.req), HttpException, 'RATE_LIMITED');
    expect(err.getStatus()).toBe(429);
    const body = err.getResponse() as { retryAfterSec: number };
    expect(body.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(call.headers['Retry-After']).toBe(String(body.retryAfterSec));

    // Another key of the same member has its own budget.
    const other = await keys.create(as(bobId), { name: 'other' });
    await auth.resolveHost(withKey(other.key).req);

    // And the first one recovers once the wait is over.
    clock += body.retryAfterSec * 1000;
    await auth.resolveHost(withKey(k.key).req);
  });

  it('sessions are never counted against it', async () => {
    for (let i = 0; i <= API_KEY_CALLS_PER_MINUTE; i++) await auth.resolveHost(as(bobId));
  });
});

describe('last_used_at_ms', () => {
  it('moves at most once a minute per key', async () => {
    const k = await keys.create(as(bobId), { name: 'agent' });
    const lastUsed = async () =>
      (await keys.list(as(bobId))).keys.find((x) => x.id === k.id)!.lastUsedAt;
    expect(await lastUsed()).toBeNull();

    await auth.resolveHost(withKey(k.key).req);
    const first = await lastUsed();
    expect(first).not.toBeNull();

    await auth.resolveHost(withKey(k.key).req);
    expect(await lastUsed()).toBe(first);

    // Seen from another pod (its own memory), a stamp inside the minute is still skipped.
    await db.run(sql`UPDATE api_key SET last_used_at_ms = ${Date.now()} WHERE id = ${k.id}`);
    const stamped = await lastUsed();
    const otherPod = new AuthService(db, new LocalAuthProvider(db, { NODE_ENV: 'test' } as never));
    await otherPod.resolveHost(withKey(k.key).req);
    expect(await lastUsed()).toBe(stamped);
  });
});
