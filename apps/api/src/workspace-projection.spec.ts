/**
 * The identity service's workspaces ARE the workspaces (0015).
 *
 * Runs the real `WorkOsAuthProvider` + `WorkspaceProjection` + `AuthService`
 * against in-memory SQLite and a fake identity service (a fetch stub that
 * records every call). What each test protects, worst first:
 *
 *   1. membership is decided by `users[]`, never by presence in the search
 *      list — the upstream search can return workspaces the caller is NOT in.
 *   2. HOME is the workspace the person opened last (upstream `last_workspace`),
 *      when they still belong to it; the header switch still works on top.
 *   3. a pre-0015 row (`external_id` = upstream ACCOUNT id) is rebound onto
 *      the upstream workspace, keeping its id, code, and forms.
 *   4. the identity service being down serves what is already local instead of
 *      locking the person out; a first-ever login with nothing local is a 503.
 *   5. a person who finished the wizard is not sent through it again for a
 *      workspace projected from upstream.
 *   6. one upstream read per TTL, not one per request.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { createDb, migrate, sql, type Db } from '@quill/db';
import { AuthService, WORKSPACE_HEADER } from './auth.service';
import { WorkOsAuthProvider } from './auth.provider.workos';
import { WorkspaceProjection } from './workspace-projection';
import { IamWorkspacesClient, roleFromIam, type IamWorkspace } from './iam-workspaces';
import { signJwtHs256 } from './jwt';
import type { ReqLike } from './auth.provider';

const SECRET = 'test-secret';
const SUB = '4bd0984c-0000-4000-8000-000000000001';
const OTHER_SUB = '4bd0984c-0000-4000-8000-000000000002';
const IAM_ACCOUNT = 'a49b1229-0000-4000-8000-0000000000aa';
const WS_OWN = '38bafc53-0000-4000-8000-0000000000b1';
const WS_INVITED = '21e7f594-0000-4000-8000-0000000000b2';
const WS_STRANGER = 'deadbeef-0000-4000-8000-0000000000b3';

function ws(id: string, name: string, accountId: string, users: IamWorkspace['users']): IamWorkspace {
  return { id, name, account_id: accountId, is_active: true, users };
}

/** A fake identity service: routes + a call log. Mutable so tests can change what it says. */
class FakeIam {
  calls: Array<{ method: string; path: string; body?: unknown }> = [];
  down = false;
  lastWorkspace: string | null = null;
  workspaces: IamWorkspace[] = [];

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    this.calls.push({ method, path: url.pathname + url.search, body });
    if (this.down) return new Response('boom', { status: 503 });
    if (!(init?.headers as Record<string, string>)?.authorization?.startsWith('Bearer '))
      return new Response('{}', { status: 401 });

    if (method === 'GET' && url.pathname === `/iam/account/${IAM_ACCOUNT}`) {
      return json({ id: IAM_ACCOUNT, feature_flags: this.lastWorkspace ? { last_workspace: this.lastWorkspace } : {} });
    }
    if (method === 'PUT' && url.pathname === `/iam/account/${IAM_ACCOUNT}`) {
      this.lastWorkspace = body?.feature_flags?.last_workspace ?? null;
      return json({ ok: true });
    }
    if (method === 'GET' && url.pathname === '/iam/workspace/search') {
      return json({ data: this.workspaces, total: this.workspaces.length, totalPages: 1 });
    }
    if (method === 'POST' && url.pathname === '/iam/workspace') {
      const created = ws(`new-${this.workspaces.length}`, body.name, body.account_id, [
        { id: `wu-new-${this.workspaces.length}`, user_id: SUB, type: 'OWNER', is_active: true, roles: [] },
      ]);
      this.workspaces.push(created);
      return json(created);
    }
    if (method === 'PUT' && url.pathname.startsWith('/iam/workspace/')) {
      const id = url.pathname.split('/').pop()!;
      const w = this.workspaces.find((x) => x.id === id);
      if (w) w.name = body.name;
      return json(w ?? {});
    }
    return new Response('not found', { status: 404 });
  };
}

function json(v: unknown, status = 200): Response {
  return new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
}

function tokenFor(sub: string, accountId = IAM_ACCOUNT): string {
  return signJwtHs256(
    { sub, account_id: accountId, email: `${sub.slice(-1)}@example.com`, name: 'Alex', iat: 1, exp: 4102444800 },
    SECRET,
  );
}

const asReq = (token: string, workspace?: string): ReqLike => ({
  headers: {
    authorization: `Bearer ${token}`,
    ...(workspace ? { [WORKSPACE_HEADER]: workspace } : {}),
  },
});

describe('workspace projection (IAM-backed workspaces)', () => {
  let db: Db;
  let iam: FakeIam;
  let projection: WorkspaceProjection;
  let auth: AuthService;
  let now = 1_700_000_000_000;

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    iam = new FakeIam();
    iam.workspaces = [
      ws(WS_OWN, 'dapta', IAM_ACCOUNT, [
        { id: 'wu-own', user_id: SUB, type: 'OWNER', is_active: true, roles: [] },
      ]),
      ws(WS_INVITED, 'Test', 'someone-elses-account', [
        { id: 'wu-them', user_id: OTHER_SUB, type: 'OWNER', is_active: true, roles: [] },
        {
          id: 'wu-me',
          user_id: SUB,
          type: 'MEMBER',
          is_active: true,
          roles: [{ role_id: 'r1', role: { name: 'workspace_admin' } }],
        },
      ]),
      // Visible in the search, but the caller is NOT in it.
      ws(WS_STRANGER, 'Siigo', 'stranger-account', [
        { id: 'wu-x', user_id: OTHER_SUB, type: 'OWNER', is_active: true, roles: [] },
      ]),
    ];
    projection = new WorkspaceProjection(
      db,
      new IamWorkspacesClient({ baseUrl: 'https://iam.test/iam', fetchImpl: iam.fetch }),
      { ttlMs: 60_000, now: () => now },
    );
    const provider = new WorkOsAuthProvider(
      db,
      { JWT_SECRET: SECRET, JWT_ISSUER: undefined, JWT_AUDIENCE: undefined, SEED_DEMO_FORM: false, ONBOARDING_WIZARD: false },
      undefined,
      projection,
    );
    auth = new AuthService(db, provider);
  });

  afterEach(async () => {
    await db.close?.();
  });

  it('projects only the workspaces the caller is a member of, with the upstream role', async () => {
    const p = await auth.resolveHost(asReq(tokenFor(SUB)));
    const list = await auth.listWorkspaces(asReq(tokenFor(SUB)));
    expect(list.map((w) => w.accountName).sort()).toEqual(['Test', 'dapta']);
    expect(list.find((w) => w.accountName === 'dapta')!.role).toBe('owner');
    expect(list.find((w) => w.accountName === 'Test')!.role).toBe('admin');
    // The stranger's workspace never became a local row.
    const stranger = await db.get<{ id: string }>(sql`SELECT id FROM account WHERE external_id = ${WS_STRANGER}`);
    expect(stranger).toBeUndefined();
    // With no last_workspace upstream, home is the oldest membership: the first projected.
    expect(list.some((w) => w.accountId === p.accountId)).toBe(true);
    // The account rows carry the upstream ids.
    const own = await db.get<{ iam_account_id: string; external_id: string }>(
      sql`SELECT iam_account_id, external_id FROM account WHERE name = 'dapta'`,
    );
    expect(own!.external_id).toBe(WS_OWN);
    expect(own!.iam_account_id).toBe(IAM_ACCOUNT);
  });

  it('home is the workspace opened last upstream, and the header still switches on top', async () => {
    iam.lastWorkspace = WS_INVITED;
    const p = await auth.resolveHost(asReq(tokenFor(SUB)));
    const home = await db.get<{ external_id: string }>(sql`SELECT external_id FROM account WHERE id = ${p.accountId}`);
    expect(home!.external_id).toBe(WS_INVITED);
    expect(p.role).toBe('admin');

    const own = await db.get<{ id: string }>(sql`SELECT id FROM account WHERE external_id = ${WS_OWN}`);
    const switched = await auth.resolveHost(asReq(tokenFor(SUB), own!.id));
    expect(switched.accountId).toBe(own!.id);
    expect(switched.role).toBe('owner');
  });

  it('a header naming a workspace the caller is not in is a 403, even if upstream lists it', async () => {
    await auth.resolveHost(asReq(tokenFor(SUB)));
    // Project the stranger's workspace as someone else so a local row exists.
    iam.workspaces[2]!.users!.push({ id: 'wu-o', user_id: OTHER_SUB, type: 'MEMBER', is_active: true, roles: [] });
    await auth.resolveHost(asReq(tokenFor(OTHER_SUB, 'stranger-account')));
    const stranger = await db.get<{ id: string }>(sql`SELECT id FROM account WHERE external_id = ${WS_STRANGER}`);
    expect(stranger).toBeDefined();
    await expect(auth.resolveHost(asReq(tokenFor(SUB), stranger!.id))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rebinds a pre-0015 account (external_id = upstream account id) onto the upstream workspace, keeping its forms', async () => {
    // A legacy row as the pre-0015 provider would have made it, with a form in it.
    await db.run(
      sql`INSERT INTO account (id, code, name, external_id, iam_account_id, created_at)
          VALUES ('legacy-1', 'lgcy01', 'Old name', ${IAM_ACCOUNT}, ${IAM_ACCOUNT}, 1)`,
    );
    await db.run(
      sql`INSERT INTO member (id, account_id, external_id, email, handle, role, status, created_at)
          VALUES ('legacy-m', 'legacy-1', ${SUB}, 'a@example.com', 'alex', 'owner', 'active', 1)`,
    );
    await db.run(
      sql`INSERT INTO form (id, account_id, slug, name, config, created_at, updated_at)
          VALUES ('f1', 'legacy-1', 'f1', 'F1', '{}', 1, 1)`,
    );

    const p = await auth.resolveHost(asReq(tokenFor(SUB)));
    // Home is the SAME local account the forms live in...
    expect(p.accountId).toBe('legacy-1');
    // ...now bound to the upstream workspace and renamed after it.
    const row = await db.get<{ external_id: string; name: string; iam_account_id: string }>(
      sql`SELECT external_id, name, iam_account_id FROM account WHERE id = 'legacy-1'`,
    );
    expect(row!.external_id).toBe(WS_OWN);
    expect(row!.name).toBe('dapta');
    expect(row!.iam_account_id).toBe(IAM_ACCOUNT);
    // And no second local account was minted for that workspace.
    const n = await db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM account WHERE external_id = ${WS_OWN}`);
    expect(Number(n!.n)).toBe(1);
  });

  it('reads upstream once per TTL, not once per request', async () => {
    await auth.resolveHost(asReq(tokenFor(SUB)));
    const after1 = iam.calls.length;
    await auth.resolveHost(asReq(tokenFor(SUB)));
    await auth.resolveHost(asReq(tokenFor(SUB)));
    expect(iam.calls.length).toBe(after1);
    now += 61_000;
    await auth.resolveHost(asReq(tokenFor(SUB)));
    expect(iam.calls.length).toBeGreaterThan(after1);
  });

  it('serves what is local when upstream is down; refuses a first-ever login with 503', async () => {
    await auth.resolveHost(asReq(tokenFor(SUB)));
    now += 61_000;
    iam.down = true;
    const p = await auth.resolveHost(asReq(tokenFor(SUB)));
    expect(p.accountId).toBeTruthy();
    await expect(auth.resolveHost(asReq(tokenFor(OTHER_SUB, 'x')))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('a membership upstream no longer names is disabled locally, never deleted', async () => {
    await auth.resolveHost(asReq(tokenFor(SUB)));
    // Removed from "Test" upstream.
    iam.workspaces[1]!.users = iam.workspaces[1]!.users!.filter((u) => u.user_id !== SUB);
    now += 61_000;
    await auth.resolveHost(asReq(tokenFor(SUB)));
    const list = await auth.listWorkspaces(asReq(tokenFor(SUB)));
    expect(list.map((w) => w.accountName)).toEqual(['dapta']);
    const row = await db.get<{ status: string }>(
      sql`SELECT m.status FROM member m JOIN account a ON a.id = m.account_id
          WHERE a.external_id = ${WS_INVITED} AND m.external_id = ${SUB}`,
    );
    expect(row!.status).toBe('disabled');
  });

  it('a person who finished the wizard is not sent through it again for a projected workspace', async () => {
    await auth.resolveHost(asReq(tokenFor(SUB)));
    await db.run(sql`UPDATE account SET onboarding_completed_at = 5 WHERE external_id = ${WS_OWN}`);
    // A third workspace appears upstream.
    iam.workspaces.push(
      ws('ws-3', 'Third', IAM_ACCOUNT, [{ id: 'wu-3', user_id: SUB, type: 'OWNER', is_active: true, roles: [] }]),
    );
    now += 61_000;
    await auth.resolveHost(asReq(tokenFor(SUB)));
    const third = await db.get<{ onboarding_completed_at: number | null }>(
      sql`SELECT onboarding_completed_at FROM account WHERE external_id = 'ws-3'`,
    );
    expect(third!.onboarding_completed_at).not.toBeNull();
    // Whereas the very first projection for a fresh human leaves the wizard on.
    const fresh = await db.get<{ onboarding_completed_at: number | null }>(
      sql`SELECT onboarding_completed_at FROM account WHERE external_id = ${WS_INVITED}`,
    );
    expect(fresh!.onboarding_completed_at).toBeNull();
  });

  it('rememberLastWorkspace writes the person’s own account upstream, even for a workspace someone else owns', async () => {
    const provider = new WorkOsAuthProvider(
      db,
      { JWT_SECRET: SECRET, JWT_ISSUER: undefined, JWT_AUDIENCE: undefined, SEED_DEMO_FORM: false, ONBOARDING_WIZARD: false },
      undefined,
      projection,
    );
    const up = (await provider.resolveUpstream!(asReq(tokenFor(SUB))))!;
    await auth.resolveHost(asReq(tokenFor(SUB)));
    const invited = await db.get<{ id: string }>(sql`SELECT id FROM account WHERE external_id = ${WS_INVITED}`);
    await projection.rememberLastWorkspace(up, invited!.id);
    const put = iam.calls.find((c) => c.method === 'PUT' && c.path === `/iam/account/${IAM_ACCOUNT}`);
    expect(put).toBeDefined();
    expect((put!.body as { feature_flags: { last_workspace: string } }).feature_flags.last_workspace).toBe(WS_INVITED);
  });
});

describe('workspace projection: edge cases', () => {
  let db: Db;
  let iam: FakeIam;
  let projection: WorkspaceProjection;
  let auth: AuthService;
  const now = 1_700_000_000_000;

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    iam = new FakeIam();
    iam.workspaces = [ws(WS_OWN, 'dapta', IAM_ACCOUNT, [{ id: 'wu-own', user_id: SUB, type: 'OWNER', is_active: true, roles: [] }])];
    projection = new WorkspaceProjection(
      db,
      new IamWorkspacesClient({ baseUrl: 'https://iam.test/iam', fetchImpl: iam.fetch }),
      { ttlMs: 60_000, now: () => now },
    );
    auth = new AuthService(
      db,
      new WorkOsAuthProvider(
        db,
        { JWT_SECRET: SECRET, JWT_ISSUER: undefined, JWT_AUDIENCE: undefined, SEED_DEMO_FORM: false, ONBOARDING_WIZARD: false },
        undefined,
        projection,
      ),
    );
  });

  afterEach(async () => {
    await db.close?.();
  });

  it('coalesces concurrent cold requests into ONE upstream read', async () => {
    await Promise.all([auth.resolveHost(asReq(tokenFor(SUB))), auth.resolveHost(asReq(tokenFor(SUB))), auth.resolveHost(asReq(tokenFor(SUB)))]);
    expect(iam.calls.filter((c) => c.path.startsWith('/iam/workspace/search')).length).toBe(1);
  });

  it('a person with no workspace anywhere is refused (403), never given a token-account row', async () => {
    iam.workspaces = [];
    await expect(auth.resolveHost(asReq(tokenFor(OTHER_SUB, 'acct-x')))).rejects.toBeInstanceOf(ForbiddenException);
    const rows = await db.all<{ id: string }>(sql`SELECT id FROM account WHERE external_id = 'acct-x'`);
    expect(rows.length).toBe(0);
  });

  it('a workspace whose users[] omits the owner still projects with the owner role', async () => {
    iam.workspaces = [{ id: WS_OWN, name: 'dapta', account_id: IAM_ACCOUNT, is_active: true, isOwner: true, users: [] }];
    const p = await auth.resolveHost(asReq(tokenFor(SUB)));
    expect(p.role).toBe('owner');
  });
});

describe('roleFromIam', () => {
  it('maps OWNER → owner, workspace_admin → admin, anything else → member', () => {
    expect(roleFromIam({ type: 'OWNER', roles: [] })).toBe('owner');
    expect(roleFromIam({ type: 'MEMBER', roles: [{ role_id: 'x', role: { name: 'workspace_admin' } }] })).toBe('admin');
    expect(roleFromIam({ type: 'MEMBER', roles: [{ role_id: 'x', role: { name: 'custom_role' } }] })).toBe('member');
    expect(roleFromIam({ type: 'MEMBER', roles: [] })).toBe('member');
    // The workspace DETAIL flattens the role: `{ id, name }` rather than `{ role_id, role: { name } }`.
    expect(roleFromIam({ type: 'MEMBER', roles: [{ id: 'x', name: 'workspace_admin' }] })).toBe('admin');
    expect(roleFromIam({ type: 'MEMBER', roles: null })).toBe('member');
  });
});
