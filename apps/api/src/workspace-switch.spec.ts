/**
 * The workspace switch, which is an AUTHORIZATION boundary before it is a
 * feature. Everything here runs the real `AuthService` against in-memory SQLite.
 *
 * What each test is protecting, worst first:
 *
 *   1. **a header cannot grant access.** `x-quill-workspace` names an account;
 *      it proves nothing. Membership is re-derived from the database on every
 *      request, and an account the caller has no row in is a 403.
 *   2. **a refusal is never a silent fallback.** Quietly serving the home
 *      account instead would put writes into a tenant the person did not
 *      believe they were in — far worse than an error.
 *   3. **a revoked membership stays revoked.** `disabled` is not selectable, no
 *      matter what the cookie remembers.
 *   4. the role comes from the TARGET account. Owning your own workspace must
 *      not make you an owner of one you were invited into.
 *   5. opening an invitation accepts it, which is the only thing that ever made
 *      `inviteMember` lead anywhere.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  createDb,
  migrate,
  seed,
  getAccountByCode,
  insertAccountWithShortCode,
  listWorkspacesForIdentity,
  sql,
  type Db,
} from '@quill/db';
import { AuthService, WORKSPACE_HEADER } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';

const EMAIL = 'alex@example.com';

describe('workspace switch', () => {
  let db: Db;
  let auth: AuthService;
  let homeAccountId: string;

  /** The dev stub resolves this email; the header names the workspace wanted. */
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
    auth = new AuthService(db, provider);
  });

  afterEach(async () => {
    await db.close();
  });

  /** A second account, optionally with a member row for our person. */
  async function makeAccount(
    name: string,
    member?: { role?: string; status?: string; email?: string; externalId?: string },
  ): Promise<string> {
    const externalId = `ext:${name}`;
    await insertAccountWithShortCode(db, { name, externalId });
    const row = await db.get<{ id: string }>(
      sql`SELECT id FROM account WHERE external_id = ${externalId} LIMIT 1`,
    );
    const accountId = String(row!.id);
    if (member) {
      await db.run(
        sql`INSERT INTO member (id, account_id, email, display_name, handle, role, status, external_id, created_at)
            VALUES (${randomUUID()}, ${accountId}, ${member.email ?? EMAIL}, ${name},
              ${`h-${name}`}, ${member.role ?? 'member'}, ${member.status ?? 'active'},
              ${member.externalId ?? null}, ${Date.now()})`,
      );
    }
    return accountId;
  }

  it('stays in the home account when no workspace is named', async () => {
    const other = await makeAccount('Beta', { role: 'admin' });
    const p = await auth.resolveHost(as());
    expect(p.accountId).toBe(homeAccountId);
    expect(p.accountId).not.toBe(other);
  });

  it('enters a workspace the caller is a member of', async () => {
    const beta = await makeAccount('Beta', { role: 'admin' });
    const p = await auth.resolveHost(as(beta));
    expect(p.accountId).toBe(beta);
    // …and as a DIFFERENT member row than the home one.
    const home = await auth.resolveHost(as());
    expect(p.memberId).not.toBe(home.memberId);
  });

  it('takes the role from the target account, not the home one', async () => {
    const beta = await makeAccount('Beta', { role: 'member' });
    const home = await auth.resolveHost(as());
    expect(home.role).toBe('owner'); // owner of their own seeded workspace
    const p = await auth.resolveHost(as(beta));
    expect(p.role).toBe('member'); // …but only a member of Beta
  });

  it('REFUSES an account the caller has no membership in', async () => {
    const stranger = await makeAccount('Stranger'); // no member row for us
    await expect(auth.resolveHost(as(stranger))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses rather than silently falling back to the home account', async () => {
    const stranger = await makeAccount('Stranger');
    // The dangerous outcome is not an error — it is a 200 scoped somewhere the
    // caller did not choose. Assert we never return at all.
    let resolved: string | null = null;
    try {
      resolved = (await auth.resolveHost(as(stranger))).accountId;
    } catch {
      /* expected */
    }
    expect(resolved).toBeNull();
  });

  it('refuses an account where the membership was disabled', async () => {
    const beta = await makeAccount('Beta', { status: 'disabled' });
    await expect(auth.resolveHost(as(beta))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a workspace id that does not exist at all', async () => {
    await expect(auth.resolveHost(as('no-such-account'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts the invitation when an invited workspace is opened', async () => {
    const beta = await makeAccount('Beta', { status: 'invited' });
    const p = await auth.resolveHost(as(beta));
    expect(p.accountId).toBe(beta);
    const row = await db.get<{ status: string }>(
      sql`SELECT status FROM member WHERE id = ${p.memberId}`,
    );
    expect(row!.status).toBe('active');
  });

  it('matches on external_id when the member row carries one', async () => {
    // Give the home member an external id, then a second account whose row
    // shares it but uses a different address — the same person to the IAM.
    const home = await auth.resolveHost(as());
    await db.run(sql`UPDATE member SET external_id = 'sub-123' WHERE id = ${home.memberId}`);
    const beta = await makeAccount('Beta', {
      email: 'different@example.com',
      externalId: 'sub-123',
    });
    const p = await auth.resolveHost(as(beta));
    expect(p.accountId).toBe(beta);
  });

  describe('the list behind the switcher', () => {
    it('returns every workspace the caller can enter, and no others', async () => {
      const beta = await makeAccount('Beta', { role: 'admin' });
      const gamma = await makeAccount('Gamma', { status: 'invited' });
      await makeAccount('Disabled', { status: 'disabled' });
      await makeAccount('Stranger'); // nobody's

      const list = await auth.listWorkspaces(as());
      const ids = list.map((w) => w.accountId).sort();
      expect(ids).toEqual([homeAccountId, beta, gamma].sort());
      expect(list.find((w) => w.accountId === gamma)!.status).toBe('invited');
    });

    it('reads the same from inside another workspace — no way to get stranded', async () => {
      const beta = await makeAccount('Beta');
      const fromHome = (await auth.listWorkspaces(as())).map((w) => w.accountId).sort();
      const fromBeta = (await auth.listWorkspaces(as(beta))).map((w) => w.accountId).sort();
      expect(fromBeta).toEqual(fromHome);
      expect(fromBeta).toContain(homeAccountId);
    });

    it('lists an account once even when both identity keys match it', async () => {
      const home = await auth.resolveHost(as());
      await db.run(sql`UPDATE member SET external_id = 'sub-123' WHERE id = ${home.memberId}`);
      const list = await listWorkspacesForIdentity(db, {
        externalId: 'sub-123',
        email: EMAIL,
      });
      expect(list.filter((w) => w.accountId === homeAccountId)).toHaveLength(1);
    });

    it('is empty for an identity with neither key', async () => {
      expect(await listWorkspacesForIdentity(db, { externalId: null, email: null })).toEqual([]);
    });
  });
});
