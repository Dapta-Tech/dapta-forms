/**
 * Create / rename / enter, on both shapes of the WorkspaceService:
 *
 *   - IAM-backed: the write goes upstream FIRST (under the caller's OWN
 *     account), then the local rows are re-projected; `enter` remembers the
 *     choice upstream.
 *   - local-only (dev stub, forks): the same operations act on local rows.
 *
 * Plus the guards that must hold on both: a plain member cannot rename, and
 * `enter` refuses an account the caller is not in.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { createDb, migrate, seed, getAccountByCode, sql, type Db } from '@quill/db';
import { AuthService, WORKSPACE_HEADER } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';
import { WorkOsAuthProvider } from './auth.provider.workos';
import { WorkspaceProjection } from './workspace-projection';
import { IamWorkspacesClient, type IamWorkspace } from './iam-workspaces';
import { WorkspaceService } from './workspace.service';
import { signJwtHs256 } from './jwt';

const SECRET = 's';
const SUB = 'sub-1';
const IAM_ACCOUNT = 'acct-1';
const WS_OWN = 'ws-own';

function json(v: unknown, status = 200): Response {
  return new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
}

describe('WorkspaceService (IAM-backed)', () => {
  let db: Db;
  let svc: WorkspaceService;
  let calls: Array<{ method: string; path: string; body?: unknown }>;
  let workspaces: IamWorkspace[];
  let lastWorkspace: string | null;
  let invitations: Array<{ id: string; workspace_id: string; invited_email: string; status: string; role_id?: string }>;

  const token = signJwtHs256({ sub: SUB, account_id: IAM_ACCOUNT, email: 'a@x.com', name: 'A', exp: 4102444800 }, SECRET);
  const req = (workspace?: string): ReqLike => ({
    headers: { authorization: `Bearer ${token}`, ...(workspace ? { [WORKSPACE_HEADER]: workspace } : {}) },
  });

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    calls = [];
    lastWorkspace = null;
    invitations = [];
    workspaces = [
      { id: WS_OWN, name: 'Mine', account_id: IAM_ACCOUNT, is_active: true, users: [{ id: 'wu1', user_id: SUB, type: 'OWNER', is_active: true, roles: [] }] },
    ];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path: url.pathname, body });
      if (method === 'GET' && url.pathname === `/iam/account/${IAM_ACCOUNT}`)
        return json({ id: IAM_ACCOUNT, feature_flags: lastWorkspace ? { last_workspace: lastWorkspace } : {} });
      if (method === 'PUT' && url.pathname === `/iam/account/${IAM_ACCOUNT}`) {
        lastWorkspace = body.feature_flags.last_workspace;
        return json({});
      }
      if (method === 'GET' && url.pathname === '/iam/workspace/search') return json({ data: workspaces, totalPages: 1 });
      if (method === 'POST' && url.pathname === '/iam/workspace') {
        const created: IamWorkspace = {
          id: `ws-new-${workspaces.length}`, name: body.name, account_id: body.account_id, is_active: true,
          users: [{ id: `wu-new`, user_id: SUB, type: 'OWNER', is_active: true, roles: [] }],
        };
        workspaces.push(created);
        return json(created, 201);
      }
      if (method === 'PUT' && url.pathname.startsWith('/iam/workspace/')) {
        const w = workspaces.find((x) => x.id === url.pathname.split('/').pop());
        if (w) w.name = body.name;
        return json(w ?? {});
      }
      if (method === 'GET' && url.pathname.startsWith('/iam/workspace/')) {
        const w = workspaces.find((x) => x.id === url.pathname.split('/').pop());
        return w ? json(w) : new Response('nf', { status: 404 });
      }
      if (method === 'GET' && url.pathname.startsWith('/iam/role/roles-workspace/'))
        return json([{ id: 'role-admin', name: 'workspace_admin', is_system: true }]);
      if (method === 'POST' && url.pathname === '/iam/workspace-invitations') {
        invitations.push({ id: `inv-${invitations.length + 1}`, workspace_id: body.workspace_id, invited_email: body.invited_email, status: 'pending', role_id: body.role_id });
        return json(invitations[invitations.length - 1], 201);
      }
      if (method === 'GET' && url.pathname.startsWith('/iam/workspace-invitations/'))
        return json({ data: invitations.filter((i) => i.status.toLowerCase() === 'pending') });
      if (method === 'POST' && url.pathname === '/iam/workspace-invitations/resend') return json({ ok: true });
      if (method === 'DELETE' && url.pathname.startsWith('/iam/workspaceUser/member/')) {
        const wuId = url.pathname.split('/').pop();
        for (const w of workspaces) w.users = (w.users ?? []).filter((u) => u.id !== wuId);
        return json({ ok: true });
      }
      return new Response('nope', { status: 404 });
    };
    const projection = new WorkspaceProjection(db, new IamWorkspacesClient({ baseUrl: 'https://iam.test/iam', fetchImpl }));
    const provider = new WorkOsAuthProvider(
      db,
      { JWT_SECRET: SECRET, JWT_ISSUER: undefined, JWT_AUDIENCE: undefined, SEED_DEMO_FORM: false, ONBOARDING_WIZARD: false },
      undefined,
      projection,
    );
    const auth = new AuthService(db, provider);
    svc = new WorkspaceService(db, provider, auth, projection);
  });

  afterEach(async () => {
    await db.close?.();
  });

  it('creates upstream under the caller’s own account, projects it, and remembers it as last opened', async () => {
    const res = await svc.create(req(), { name: 'Sales' });
    const post = calls.find((c) => c.method === 'POST' && c.path === '/iam/workspace');
    expect(post).toBeDefined();
    expect((post!.body as { account_id: string }).account_id).toBe(IAM_ACCOUNT);
    const row = await db.get<{ name: string; external_id: string }>(sql`SELECT name, external_id FROM account WHERE id = ${res.accountId}`);
    expect(row!.name).toBe('Sales');
    expect(row!.external_id).toBe('ws-new-1');
    const me = await db.get<{ role: string }>(sql`SELECT role FROM member WHERE account_id = ${res.accountId} AND external_id = ${SUB}`);
    expect(me!.role).toBe('owner');
    expect(lastWorkspace).toBe('ws-new-1');
    // And it is in the switcher list.
    const list = await svc.list(req());
    expect(list.map((w) => w.accountName).sort()).toEqual(['Mine', 'Sales']);
  });

  it('a new workspace does not re-trigger the wizard for someone who already finished it', async () => {
    await svc.list(req()); // project
    await db.run(sql`UPDATE account SET onboarding_completed_at = 1 WHERE external_id = ${WS_OWN}`);
    const res = await svc.create(req(), { name: 'Second' });
    const row = await db.get<{ onboarding_completed_at: number | null }>(sql`SELECT onboarding_completed_at FROM account WHERE id = ${res.accountId}`);
    expect(row!.onboarding_completed_at).not.toBeNull();
  });

  it('renames upstream then locally; a plain member cannot', async () => {
    await svc.list(req());
    const out = await svc.rename(req(), { name: 'Renamed' });
    expect(calls.some((c) => c.method === 'PUT' && c.path === `/iam/workspace/${WS_OWN}`)).toBe(true);
    const row = await db.get<{ name: string }>(sql`SELECT name FROM account WHERE id = ${out.accountId}`);
    expect(row!.name).toBe('Renamed');

    // Demoted UPSTREAM (the authority): the rename invalidated the cache, so the
    // next request re-projects and the guard sees `member`.
    workspaces[0]!.users![0]!.type = 'MEMBER';
    await expect(svc.rename(req(), { name: 'Nope' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('enter re-checks membership and writes last_workspace upstream; a stranger account is a 403', async () => {
    const list = await svc.list(req());
    await svc.enter(req(), list[0]!.accountId);
    expect(lastWorkspace).toBe(WS_OWN);
    await expect(svc.enter(req(), 'not-mine')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('roster is re-projected from the upstream users[]: joiners appear, leavers are disabled', async () => {
    await svc.list(req());
    workspaces[0]!.users!.push({ id: 'wu2', user_id: 'sub-2', type: 'MEMBER', is_active: true, roles: [], user: { email: 'b@x.com', name: 'B' } });
    let roster = await svc.roster(req());
    expect(roster.map((m) => m.email).sort()).toEqual(['a@x.com', 'b@x.com']);
    expect(roster.find((m) => m.email === 'b@x.com')!.role).toBe('member');
    workspaces[0]!.users = workspaces[0]!.users!.filter((u) => u.id !== 'wu2');
    roster = await svc.roster(req());
    expect(roster.find((m) => m.email === 'b@x.com')!.status).toBe('disabled');
  });

  it('invites through the identity service (admin → workspace_admin role_id) and lists it as pending; no local member row', async () => {
    await svc.list(req());
    const out = await svc.inviteUpstream(req(), { email: 'New@X.com', role: 'admin' });
    expect(out.status).toBe('invited');
    const post = calls.find((c) => c.method === 'POST' && c.path === '/iam/workspace-invitations');
    expect((post!.body as { invited_email: string; role_id: string; workspace_id: string })).toMatchObject({
      invited_email: 'new@x.com', role_id: 'role-admin', workspace_id: WS_OWN,
    });
    const local = await db.get<{ id: string }>(sql`SELECT id FROM member WHERE lower(email) = 'new@x.com'`);
    expect(local).toBeUndefined();
    const pending = await svc.listInvitations(req());
    expect(pending.map((i) => i.email)).toEqual(['new@x.com']);
    await svc.resendInvitation(req(), pending[0]!.id);
    expect(calls.some((c) => c.path === '/iam/workspace-invitations/resend')).toBe(true);
  });

  it('removes a member upstream first, then locally', async () => {
    await svc.list(req());
    workspaces[0]!.users!.push({ id: 'wu2', user_id: 'sub-2', type: 'MEMBER', is_active: true, roles: [], user: { email: 'b@x.com', name: 'B' } });
    const roster = await svc.roster(req());
    const b = roster.find((m) => m.email === 'b@x.com')!;
    await svc.removeMemberUpstream(req(), b.id);
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/iam/workspaceUser/member/wu2')).toBe(true);
    const gone = await db.get<{ id: string }>(sql`SELECT id FROM member WHERE id = ${b.id}`);
    expect(gone).toBeUndefined();
  });

  it('refresh forces an upstream re-read within the TTL', async () => {
    await svc.list(req());
    const before = calls.filter((c) => c.path === '/iam/workspace/search').length;
    workspaces.push({ id: 'ws-late', name: 'Late', account_id: 'other', is_active: true, users: [{ id: 'wu-l', user_id: SUB, type: 'MEMBER', is_active: true, roles: [] }] });
    const list = await svc.refresh(req());
    expect(calls.filter((c) => c.path === '/iam/workspace/search').length).toBe(before + 1);
    expect(list.map((w) => w.accountName).sort()).toEqual(['Late', 'Mine']);
  });
});

describe('WorkspaceService (local-only)', () => {
  let db: Db;
  let svc: WorkspaceService;
  const req = (email = 'alex@example.com', workspace?: string): ReqLike => ({
    headers: { 'x-quill-email': email, ...(workspace ? { [WORKSPACE_HEADER]: workspace } : {}) },
  });

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    const provider = new LocalAuthProvider(db, {
      NODE_ENV: 'test', DEV_LOGIN_EMAIL: undefined, AUTH_LOCAL_STRICT: undefined, SEED_DEMO_FORM: false, ONBOARDING_WIZARD: false,
    });
    const auth = new AuthService(db, provider);
    svc = new WorkspaceService(db, provider, auth, null);
  });

  afterEach(async () => {
    await db.close?.();
  });

  it('creates a local workspace with the caller as owner and lists it', async () => {
    const home = (await getAccountByCode(db, 'acme'))!.id;
    const res = await svc.create(req(), { name: 'Side project' });
    expect(res.accountId).not.toBe(home);
    const me = await db.get<{ role: string; email: string }>(sql`SELECT role, email FROM member WHERE account_id = ${res.accountId}`);
    expect(me!.role).toBe('owner');
    expect(me!.email).toBe('alex@example.com');
    const list = await svc.list(req());
    expect(list.some((w) => w.accountId === res.accountId)).toBe(true);
    // And it can be entered via the header.
    const p = await new AuthService(db, new LocalAuthProvider(db, {
      NODE_ENV: 'test', DEV_LOGIN_EMAIL: undefined, AUTH_LOCAL_STRICT: undefined, SEED_DEMO_FORM: false, ONBOARDING_WIZARD: false,
    })).resolveHost(req('alex@example.com', res.accountId));
    expect(p.role).toBe('owner');
  });

  it('renames locally', async () => {
    const out = await svc.rename(req(), { name: 'Acme Renamed' });
    const row = await db.get<{ name: string }>(sql`SELECT name FROM account WHERE id = ${out.accountId}`);
    expect(row!.name).toBe('Acme Renamed');
  });
});
