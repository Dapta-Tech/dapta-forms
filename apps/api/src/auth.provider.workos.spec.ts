import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, migrate, seed, sql, type Db } from '@slate/db';
import { loadServerEnv } from '@slate/config/env';
import { createAuthProvider, type ReqLike } from './auth.provider';
import { WorkOsAuthProvider } from './auth.provider.workos';
import { signJwtHs256 } from './jwt';

const SECRET = 'workos-provider-test-secret';
const ISS = 'example-identity-service';
const AUD = 'calendar-platform';

function bearer(token: string): ReqLike {
  return { headers: { authorization: `Bearer ${token}` } };
}

function mint(claims: Record<string, unknown>): string {
  const nowSec = Math.floor(Date.now() / 1000);
  return signJwtHs256({ iss: ISS, aud: AUD, exp: nowSec + 3600, ...claims }, SECRET);
}

describe('WorkOsAuthProvider — validates the platform JWT and projects a principal', () => {
  let db: Db;
  const env = { JWT_SECRET: SECRET, JWT_ISSUER: ISS, JWT_AUDIENCE: AUD };

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
  });

  it('JIT-provisions an account + member on first login, keyed by claims', async () => {
    const provider = new WorkOsAuthProvider(db, env);
    const p = await provider.resolveHost(bearer(mint({ account_id: 'ext_acct_1', sub: 'ext_user_1', email: 'a@x.io', name: 'Ada' })));

    const acct = await db.get<{ id: string; external_id: string }>(
      sql`SELECT id, external_id FROM account WHERE external_id = 'ext_acct_1'`,
    );
    const mem = await db.get<{ id: string; email: string; external_id: string }>(
      sql`SELECT id, email, external_id FROM member WHERE external_id = 'ext_user_1'`,
    );
    expect(acct).toBeDefined();
    expect(mem).toBeDefined();
    expect(p.accountId).toBe(acct!.id);
    expect(p.memberId).toBe(mem!.id);
    expect(mem!.email).toBe('a@x.io');
  });

  it('is idempotent — a second login resolves the SAME rows (no duplicates)', async () => {
    const provider = new WorkOsAuthProvider(db, env);
    const t = mint({ account_id: 'ext_acct_2', sub: 'ext_user_2' });
    const first = await provider.resolveHost(bearer(t));
    const second = await provider.resolveHost(bearer(t));
    expect(second).toEqual(first);

    const accounts = await db.all(sql`SELECT id FROM account WHERE external_id = 'ext_acct_2'`);
    const members = await db.all(sql`SELECT id FROM member WHERE external_id = 'ext_user_2'`);
    expect(accounts.length).toBe(1);
    expect(members.length).toBe(1);
  });

  it('two users in the same external account share one account, distinct members', async () => {
    const provider = new WorkOsAuthProvider(db, env);
    const a = await provider.resolveHost(bearer(mint({ account_id: 'ext_acct_3', sub: 'user_a' })));
    const b = await provider.resolveHost(bearer(mint({ account_id: 'ext_acct_3', sub: 'user_b' })));
    expect(a.accountId).toBe(b.accountId);
    expect(a.memberId).not.toBe(b.memberId);
  });

  it('rejects a missing bearer token (401)', async () => {
    const provider = new WorkOsAuthProvider(db, env);
    await expect(provider.resolveHost({ headers: {} })).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a token signed with the wrong secret (401)', async () => {
    const provider = new WorkOsAuthProvider(db, env);
    const forged = signJwtHs256(
      { iss: ISS, aud: AUD, exp: Math.floor(Date.now() / 1000) + 3600, account_id: 'x', sub: 'y' },
      'not-the-secret',
    );
    await expect(provider.resolveHost(bearer(forged))).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a token missing account_id / sub (401)', async () => {
    const provider = new WorkOsAuthProvider(db, env);
    await expect(provider.resolveHost(bearer(mint({ sub: 'only_sub' })))).rejects.toMatchObject({ status: 401 });
    await expect(provider.resolveHost(bearer(mint({ account_id: 'only_acct' })))).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a wrong-issuer / wrong-audience token (401)', async () => {
    const provider = new WorkOsAuthProvider(db, env);
    const nowSec = Math.floor(Date.now() / 1000);
    const badIss = signJwtHs256({ iss: 'evil', aud: AUD, exp: nowSec + 3600, account_id: 'a', sub: 'b' }, SECRET);
    const badAud = signJwtHs256({ iss: ISS, aud: 'evil', exp: nowSec + 3600, account_id: 'a', sub: 'b' }, SECRET);
    await expect(provider.resolveHost(bearer(badIss))).rejects.toMatchObject({ status: 401 });
    await expect(provider.resolveHost(bearer(badAud))).rejects.toMatchObject({ status: 401 });
  });
});

describe('createAuthProvider — workos wiring stays fail-loud without a secret', () => {
  it('throws for workos when JWT_SECRET is absent (never silent stub fallback)', async () => {
    const db = await createDb('file::memory:');
    expect(() => createAuthProvider(loadServerEnv({ AUTH_PROVIDER: 'workos' }), db)).toThrow(/workos|JWT_SECRET/i);
  });

  it('returns the WorkOsAuthProvider when JWT_SECRET is set', async () => {
    const db = await createDb('file::memory:');
    const provider = createAuthProvider(
      loadServerEnv({ AUTH_PROVIDER: 'workos', JWT_SECRET: SECRET, JWT_ISSUER: ISS, JWT_AUDIENCE: AUD }),
      db,
    );
    expect(provider.name).toBe('workos');
  });
});
