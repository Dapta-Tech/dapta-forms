/**
 * The principal says HOW the caller got in: `via: 'session'` for the browser
 * session every route serves today, `via: 'api_key'` (with `apiKeyId`) for an
 * API key. The key path lands in its own change; what this file pins is that a
 * session principal gains `via` and nothing else, so no existing caller sees a
 * different account, member or role, and that the helper the key, validation
 * and metric code ask ("did this request come with a key?") answers right.
 *
 * Runs the real `AuthService` over the local provider on in-memory SQLite.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createDb,
  migrate,
  seed,
  getAccountByCode,
  insertAccountWithShortCode,
  sql,
  type Db,
} from '@quill/db';
import {
  AuthService,
  WORKSPACE_HEADER,
  isApiKeyPrincipal,
  type HostPrincipal,
} from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';

const EMAIL = 'alex@example.com';

describe('host principal via', () => {
  let db: Db;
  let auth: AuthService;
  let homeAccountId: string;
  let homeMemberId: string;

  const as = (workspace?: string): ReqLike => ({
    headers: { 'x-quill-email': EMAIL, ...(workspace ? { [WORKSPACE_HEADER]: workspace } : {}) },
  });

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    homeAccountId = (await getAccountByCode(db, 'acme'))!.id;
    const provider = new LocalAuthProvider(db, {
      NODE_ENV: 'test',
      DEV_LOGIN_EMAIL: undefined,
      AUTH_LOCAL_STRICT: undefined,
      SEED_DEMO_FORM: false,
      ONBOARDING_WIZARD: false,
    });
    homeMemberId = (await provider.resolveHost(as())).memberId;
    auth = new AuthService(db, provider);
  });

  afterEach(async () => {
    await db.close();
  });

  it("a session principal is the same principal as before plus via: 'session', and no apiKeyId", async () => {
    const p = await auth.resolveHost(as());
    expect(p).toEqual({
      accountId: homeAccountId,
      memberId: homeMemberId,
      role: 'owner',
      via: 'session',
    });
    expect(Object.keys(p).sort()).toEqual(['accountId', 'memberId', 'role', 'via']);
  });

  it("stays 'session' inside another workspace the caller entered with the header", async () => {
    const externalId = 'ext:beta';
    await insertAccountWithShortCode(db, { name: 'Beta', externalId });
    const beta = String(
      (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE external_id = ${externalId}`))!
        .id,
    );
    const memberId = randomUUID();
    await db.run(
      sql`INSERT INTO member (id, account_id, email, display_name, handle, role, status, created_at)
          VALUES (${memberId}, ${beta}, ${EMAIL}, ${'Beta'}, ${'h-beta'}, ${'admin'}, ${'active'}, ${Date.now()})`,
    );
    const p = await auth.resolveHost(as(beta));
    expect(p).toEqual({ accountId: beta, memberId, role: 'admin', via: 'session' });
  });

  describe('isApiKeyPrincipal', () => {
    const base = { accountId: 'a', memberId: 'm', role: 'member' } as const;

    it('is false for a session principal', async () => {
      expect(isApiKeyPrincipal(await auth.resolveHost(as()))).toBe(false);
      expect(isApiKeyPrincipal({ ...base, via: 'session' })).toBe(false);
    });

    it('is true for an API key principal', () => {
      const p: HostPrincipal = { ...base, via: 'api_key', apiKeyId: 'key_1' };
      expect(isApiKeyPrincipal(p)).toBe(true);
    });

    it('needs only `via`, so a narrowed principal works too', () => {
      expect(isApiKeyPrincipal({ via: 'api_key' })).toBe(true);
      expect(isApiKeyPrincipal({ via: 'session' })).toBe(false);
    });
  });
});
