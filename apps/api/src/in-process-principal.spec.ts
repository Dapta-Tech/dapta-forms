/**
 * The in-process principal: the member (a person in one workspace) an MCP
 * tool call acts as, handed to the app's own handlers on a request the MCP
 * adapter builds. `AuthService.resolveHost` recognizes it and holds it to the
 * rules of an API key: the member is re-read on every call (gone or not
 * active: 401), its role is the live one, the strict validation applies and a
 * form it creates records `created_via = 'mcp'`.
 *
 * Runs the real `AuthService` over the local provider on in-memory SQLite.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { createDb, getAccountByCode, insertApiKey, migrate, seed, sql, type Db } from '@quill/db';
import { createdVia, generateApiKey } from './api-keys';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type AuthProvider, type ReqLike } from './auth.provider';
import { inProcessRequest } from './in-process-principal';
import { TokenBucketRateLimiter } from './rate-limit';
import { WorkspaceService } from './workspace.service';
import type { WorkspaceProjection } from './workspace-projection';

let db: Db;
let auth: AuthService;
let accountId: string;

/** A local provider that answers 401 to a request without an identity, like a real one. */
const strictProvider = () =>
  new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: true,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });

async function addMember(role: 'owner' | 'admin' | 'member', status = 'active'): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO member (id, account_id, email, display_name, handle, role, status, created_at)
        VALUES (${id}, ${accountId}, ${`${id.slice(0, 8)}@example.com`}, ${'Spec'}, ${`h-${id.slice(0, 8)}`},
          ${role}, ${status}, ${Date.now()})`,
  );
  return id;
}

async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
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
  accountId = (await getAccountByCode(db, 'acme'))!.id;
  auth = new AuthService(db, strictProvider());
});

afterEach(async () => {
  await db.close();
});

describe('an MCP connection principal', () => {
  it('resolves to its member and workspace with the live role, as an MCP connection', async () => {
    const memberId = await addMember('member');
    const p = await auth.resolveHost(inProcessRequest({ accountId, memberId }));
    expect(p).toEqual({ accountId, memberId, role: 'member', via: 'mcp_connection', channel: 'mcp' });
    expect(createdVia(p)).toBe('mcp');
  });

  it('reads the role on every call, never from the principal', async () => {
    const memberId = await addMember('member');
    const req = inProcessRequest({ accountId, memberId });
    expect((await auth.resolveHost(req)).role).toBe('member');
    await db.run(sql`UPDATE member SET role = 'admin' WHERE id = ${memberId}`);
    expect((await auth.resolveHost(req)).role).toBe('admin');
  });

  it('fails the next call once the member is disabled, removed, or was never active', async () => {
    const memberId = await addMember('member');
    const req = inProcessRequest({ accountId, memberId });
    expect(await statusOf(auth.resolveHost(req))).toBe(200);
    await db.run(sql`UPDATE member SET status = 'disabled' WHERE id = ${memberId}`);
    expect(await statusOf(auth.resolveHost(req))).toBe(401);

    const removed = await addMember('admin');
    const removedReq = inProcessRequest({ accountId, memberId: removed });
    expect(await statusOf(auth.resolveHost(removedReq))).toBe(200);
    await db.run(sql`DELETE FROM member WHERE id = ${removed}`);
    expect(await statusOf(auth.resolveHost(removedReq))).toBe(401);

    const invited = await addMember('member', 'invited');
    expect(await statusOf(auth.resolveHost(inProcessRequest({ accountId, memberId: invited })))).toBe(401);
  });

  it('acts only in the workspace it names: a member of another workspace is a 401, not a switch', async () => {
    const memberId = await addMember('owner');
    const other = randomUUID();
    await db.run(sql`INSERT INTO account (id, code, name, created_at) VALUES (${other}, 'globex', 'Globex', ${Date.now()})`);
    expect(await statusOf(auth.resolveHost(inProcessRequest({ accountId: other, memberId })))).toBe(401);
    const req = inProcessRequest({ accountId, memberId });
    req.headers['x-quill-workspace'] = other;
    expect((await auth.resolveHost(req)).accountId).toBe(accountId);
  });
});

async function mint(memberId: string) {
  const k = generateApiKey();
  const res = await insertApiKey(db, { accountId, memberId, name: 'spec', keyHash: k.keyHash, prefix: k.prefix, last4: k.last4 });
  if (!res.ok) throw new Error('mint failed');
  return k;
}

describe('an API key through the MCP', () => {
  it('resolves to exactly what the key resolves to over REST, labelled mcp', async () => {
    const memberId = await addMember('admin');
    const k = await mint(memberId);
    const rest = await auth.resolveHost({ headers: { authorization: `Bearer ${k.key}` } });
    const viaMcp = await auth.resolveHost(inProcessRequest({ accountId, memberId, apiKeyHash: k.keyHash }));
    expect(viaMcp).toEqual({ ...rest, channel: 'mcp' });
    expect(viaMcp).toMatchObject({ via: 'api_key', role: 'admin' });
    expect(createdVia(rest)).toBe('api');
    expect(createdVia(viaMcp)).toBe('mcp');
  });

  it('fails the next call once the key is revoked or its member disabled', async () => {
    const memberId = await addMember('member');
    const k = await mint(memberId);
    const req = inProcessRequest({ accountId, memberId, apiKeyHash: k.keyHash });
    expect(await statusOf(auth.resolveHost(req))).toBe(200);
    await db.run(sql`UPDATE api_key SET revoked_at_ms = ${Date.now()} WHERE key_hash = ${k.keyHash}`);
    expect(await statusOf(auth.resolveHost(req))).toBe(401);

    const other = await addMember('member');
    const k2 = await mint(other);
    const req2 = inProcessRequest({ accountId, memberId: other, apiKeyHash: k2.keyHash });
    await db.run(sql`UPDATE member SET status = 'disabled' WHERE id = ${other}`);
    expect(await statusOf(auth.resolveHost(req2))).toBe(401);
  });

  it('is a 401 when the key belongs to another member than the principal names', async () => {
    const memberId = await addMember('member');
    const owner = await addMember('owner');
    const k = await mint(memberId);
    expect(await statusOf(auth.resolveHost(inProcessRequest({ accountId, memberId: owner, apiKeyHash: k.keyHash })))).toBe(401);
  });

  it('spends the same per-key budget as the key does over REST', async () => {
    auth = new AuthService(db, strictProvider(), undefined, new TokenBucketRateLimiter(2, 0.0001));
    const memberId = await addMember('member');
    const k = await mint(memberId);
    expect(await statusOf(auth.resolveHost({ headers: { authorization: `Bearer ${k.key}` } }))).toBe(200);
    expect(await statusOf(auth.resolveHost(inProcessRequest({ accountId, memberId, apiKeyHash: k.keyHash })))).toBe(200);
    expect(await statusOf(auth.resolveHost(inProcessRequest({ accountId, memberId, apiKeyHash: k.keyHash })))).toBe(429);
  });
});

describe('nothing from outside can produce it', () => {
  it('a request that only looks like one, in headers, body or a copy of a real one, gets no principal', async () => {
    const memberId = await addMember('owner');
    const real = inProcessRequest({ accountId, memberId });
    const lookalikes: ReqLike[] = [
      { ...real },
      JSON.parse(JSON.stringify(real)) as ReqLike,
      { headers: { 'x-quill-principal': JSON.stringify({ accountId, memberId }), 'x-quill-channel': 'mcp' } },
      Object.assign({ headers: {} }, { body: { accountId, memberId, via: 'mcp_connection', channel: 'mcp' } }),
      Object.assign({ headers: {} }, { principal: { accountId, memberId }, inProcess: true }),
    ];
    for (const req of lookalikes) expect(await statusOf(auth.resolveHost(req))).toBe(401);
  });
});

describe('the upstream identity service', () => {
  // Staff over MCP is decided at the door (`authenticateMcpConnection`), from
  // the person directory's email, and reaches a workspace through the caller
  // the door builds; see mcp-workspaces.integration.spec.ts. The web app's
  // workspace service, which reads staff off the upstream session, never
  // answers staff for an in-process request, and never calls upstream for one.
  it('is never asked about an in-process request: it carries no session to forward', async () => {
    const memberId = await addMember('owner');
    let upstreamCalls = 0;
    const provider: AuthProvider = {
      name: 'spec',
      resolveHost: () => Promise.reject(new Error('not used')),
      resolveUpstream: () => {
        upstreamCalls++;
        return Promise.reject(new Error('no bearer on this request'));
      },
    };
    const projection = { isStaff: () => true } as unknown as WorkspaceProjection;
    const svc = new WorkspaceService(db, provider, auth, projection);
    expect(await svc.isStaff(inProcessRequest({ accountId, memberId }))).toBe(false);
    const k = await mint(memberId);
    expect(await svc.isStaff(inProcessRequest({ accountId, memberId, apiKeyHash: k.keyHash }))).toBe(false);
    expect(upstreamCalls).toBe(0);
  });
});
