/**
 * The pieces of the MCP adapter that are not the tools: how a bearer becomes a
 * caller, how the app's HTTP errors become the port's, and how a form the MCP
 * creates is told apart from one the REST API creates.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { createDb, getAccountByCode, insertApiKey, migrate, seed, sql, type Db } from '@quill/db';
import { BackendError } from '@quill/mcp';
import { createdVia, generateApiKey, isMcpRequest, markMcpRequest } from './api-keys';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';
import { authenticateMcpKey, toBackendError } from './mcp.backend';

let db: Db;
let accountId: string;
let ownerId: string;

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
  accountId = (await getAccountByCode(db, 'acme'))!.id;
  ownerId = (await db.get<{ id: string }>(sql`SELECT id FROM member WHERE account_id = ${accountId}`))!.id;
});

afterEach(async () => {
  await db.close();
});

async function mint(memberId = ownerId) {
  const k = generateApiKey();
  const res = await insertApiKey(db, { accountId, memberId, name: 'spec', keyHash: k.keyHash, prefix: k.prefix, last4: k.last4 });
  if (!res.ok) throw new Error('mint failed');
  return k;
}

describe('authenticateMcpKey', () => {
  it("resolves an active key to its member, role and stored prefix, carrying the request the app's handlers resolve", async () => {
    const k = await mint();
    const caller = await authenticateMcpKey(db, k.key);
    expect(caller).toMatchObject({ accountId, memberId: ownerId, role: 'owner', label: k.prefix });
    const req = (caller!.context as { req: ReqLike }).req;
    expect(req.headers).toEqual({ authorization: `Bearer ${k.key}` });
    expect(isMcpRequest(req)).toBe(true);
    // The marker never serializes: a request cannot be logged into carrying it, nor rebuilt from JSON.
    expect(JSON.stringify(req)).not.toContain('mcp');
  });

  it('refuses a non-key bearer, an unknown key, a revoked key and a disabled member', async () => {
    expect(await authenticateMcpKey(db, 'eyJhbGciOiJIUzI1NiJ9.session.token')).toBeNull();
    expect(await authenticateMcpKey(db, generateApiKey().key)).toBeNull();
    const revoked = await mint();
    await db.run(sql`UPDATE api_key SET revoked_at_ms = ${Date.now()} WHERE prefix = ${revoked.prefix}`);
    expect(await authenticateMcpKey(db, revoked.key)).toBeNull();
    const k = await mint();
    await db.run(sql`UPDATE member SET status = 'disabled' WHERE id = ${ownerId}`);
    expect(await authenticateMcpKey(db, k.key)).toBeNull();
  });
});

describe('the mcp channel', () => {
  const provider = () =>
    new LocalAuthProvider(db, {
      NODE_ENV: 'test',
      DEV_LOGIN_EMAIL: undefined,
      AUTH_LOCAL_STRICT: undefined,
      SEED_DEMO_FORM: false,
      ONBOARDING_WIZARD: false,
    });

  it('labels a key principal mcp only when the MCP adapter built the request', async () => {
    const auth = new AuthService(db, provider());
    const k = await mint();
    const rest = await auth.resolveHost({ headers: { authorization: `Bearer ${k.key}`, 'x-quill-channel': 'mcp' } });
    expect(rest.channel).toBeUndefined();
    expect(createdVia(rest)).toBe('api');
    const viaMcp = await auth.resolveHost(markMcpRequest({ headers: { authorization: `Bearer ${k.key}` } }));
    expect(viaMcp).toMatchObject({ via: 'api_key', channel: 'mcp', role: 'owner' });
    expect(createdVia(viaMcp)).toBe('mcp');
  });

  it('never applies to a session, whatever is on the request', async () => {
    const auth = new AuthService(db, provider());
    const p = await auth.resolveHost(markMcpRequest({ headers: { 'x-quill-email': 'alex@example.com' } }));
    expect(p.channel).toBeUndefined();
    expect(createdVia(p)).toBe('web');
    expect(createdVia({ via: 'session', channel: 'mcp' })).toBe('web');
  });
});

describe('toBackendError', () => {
  it('keeps the status, the code, every issue and the facts a model can act on', () => {
    const issues = [{ path: 'config.steps.0.question', message: 'Every step needs a question.', code: 'EMPTY_QUESTION' }];
    const v = toBackendError(new BadRequestException({ error: 'BAD_REQUEST', message: 'Every step needs a question.', issues }));
    expect(v).toBeInstanceOf(BackendError);
    expect(v).toMatchObject({ status: 400, code: 'BAD_REQUEST', issues });
    const stale = toBackendError(new ConflictException({ error: 'STALE', message: 'Saved elsewhere.', updatedAt: 42, current: { secret: 1 } }));
    expect(stale).toMatchObject({ status: 409, code: 'STALE', details: { updatedAt: 42 } });
    expect(JSON.stringify((stale as BackendError).details)).not.toContain('secret');
    expect(toBackendError(new NotFoundException())).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(toBackendError(new ForbiddenException({ error: 'FORBIDDEN', message: 'Requires an admin or owner.' }))).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(toBackendError(new HttpException({ error: 'RATE_LIMITED', message: 'Slow.', retryAfterSec: 9 }, 429))).toMatchObject({
      details: { retryAfterSec: 9 },
    });
  });

  it('leaves anything that is not an HTTP error untouched', () => {
    const err = new Error('db down');
    expect(toBackendError(err)).toBe(err);
  });
});
