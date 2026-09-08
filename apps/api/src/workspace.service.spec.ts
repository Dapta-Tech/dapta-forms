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
import { ConflictException, ForbiddenException } from '@nestjs/common';
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
  /** Test seams: the fake clock the role-catalog cache reads, and a way to make `/role` fail. */
  let clock: number;
  let roleCatalogStatus: number;

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
    clock = 1_000_000;
    roleCatalogStatus = 200;
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
      if (method === 'GET' && url.pathname === '/iam/workspace/search') {
        // Like the real thing: `query` filters by name; the estate is returned
        // to everyone here (the fake has no idea who is staff), so the SERVICE
        // is what keeps non-staff to their memberships.
        const q = (url.searchParams.get('query') ?? '').toLowerCase();
        const rows = q ? workspaces.filter((w) => w.name.toLowerCase().includes(q)) : workspaces;
        return json({ data: rows, total: rows.length, totalPages: 1 });
      }
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
      // Like the real thing: the per-workspace list carries ONLY workspace_admin
      // (+ custom roles); the other system roles live in the catalog.
      if (method === 'GET' && url.pathname.startsWith('/iam/role/roles-workspace/'))
        return json([{ id: 'role-admin', name: 'workspace_admin', is_system: true }]);
      if (method === 'GET' && url.pathname === '/iam/role' && roleCatalogStatus !== 200)
        return new Response('nope', { status: roleCatalogStatus });
      if (method === 'GET' && url.pathname === '/iam/role')
        return json([
          { id: 'role-admin', name: 'workspace_admin', is_system: true },
          { id: 'role-editor', name: 'workspace_editor', is_system: true },
          { id: 'role-viewer', name: 'workspace_viewer', is_system: true },
          { id: 'role-ws-owner', name: 'workspace_owner', is_system: true },
          { id: 'role-custom', name: 'workspace_editor', is_system: false, workspace_id: 'elsewhere' },
        ]);
      if (method === 'POST' && url.pathname === '/iam/workspaceUser/assign-role') {
        const name = ({ 'role-admin': 'workspace_admin', 'role-editor': 'workspace_editor' } as Record<string, string>)[body.role_id];
        if (!name) return new Response('bad role', { status: 400 });
        for (const w of workspaces) for (const u of w.users ?? []) if (u.id === body.workspace_user_id) u.roles = [{ id: body.role_id, name }];
        return json({ ok: true });
      }
      if (method === 'PUT' && url.pathname === '/iam/workspaceUser') {
        for (const w of workspaces) for (const u of w.users ?? []) if (u.id === body.id) u.is_active = body.is_active;
        return json({ ok: true });
      }
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
    const projection = new WorkspaceProjection(
      db,
      new IamWorkspacesClient({ baseUrl: 'https://iam.test/iam', fetchImpl, now: () => clock }),
      { staffDomains: ['staff.test'] },
    );
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

  it('sets the workspace timezone locally (admin), claims only while unset, and refuses a plain member', async () => {
    await svc.list(req());
    const set = await svc.setTimezone(req(), { timezone: 'America/Bogota' });
    expect(set).toEqual({ accountId: set.accountId, timezone: 'America/Bogota', applied: true });
    const row = await db.get<{ timezone: string | null }>(sql`SELECT timezone FROM account WHERE id = ${set.accountId}`);
    expect(row!.timezone).toBe('America/Bogota');

    // A browser's write-once seed does not overwrite an explicit choice.
    const claim = await svc.setTimezone(req(), { timezone: 'Europe/Madrid', onlyIfUnset: true });
    expect(claim).toEqual({ accountId: set.accountId, timezone: 'America/Bogota', applied: false });

    // Clearing goes back to UTC (null).
    expect((await svc.setTimezone(req(), { timezone: null })).timezone).toBeNull();
  });

  it('a plain member cannot set the workspace timezone', async () => {
    // Demoted upstream before the first projection, so the guard sees `member`.
    workspaces[0]!.users![0]!.type = 'MEMBER';
    await expect(svc.setTimezone(req(), { timezone: 'Asia/Tokyo' })).rejects.toBeInstanceOf(ForbiddenException);
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

  it('invites a MEMBER with the editor role_id (from the system catalog, not the per-workspace list)', async () => {
    await svc.list(req());
    await svc.inviteUpstream(req(), { email: 'ed@x.com', role: 'member' });
    const post = calls.find((c) => c.method === 'POST' && c.path === '/iam/workspace-invitations');
    expect((post!.body as { role_id: string }).role_id).toBe('role-editor');
    expect(calls.some((c) => c.method === 'GET' && c.path === '/iam/role')).toBe(true);
  });

  it('promotes (assign workspace_admin) and DEMOTES (assign workspace_editor) through assign-role; the roster reflects it', async () => {
    await svc.list(req());
    workspaces[0]!.users!.push({ id: 'wu2', user_id: 'sub-2', type: 'MEMBER', is_active: true, roles: [], user: { email: 'b@x.com', name: 'B' } });
    let b = (await svc.roster(req())).find((m) => m.email === 'b@x.com')!;
    expect(b.role).toBe('member');

    const promoted = await svc.updateMemberUpstream(req(), b.id, { role: 'admin' });
    expect(promoted.role).toBe('admin');
    let assign = calls.filter((c) => c.method === 'POST' && c.path === '/iam/workspaceUser/assign-role');
    expect(assign.at(-1)!.body).toEqual({ workspace_user_id: 'wu2', role_id: 'role-admin' });

    const demoted = await svc.updateMemberUpstream(req(), b.id, { role: 'member' });
    expect(demoted.role).toBe('member');
    assign = calls.filter((c) => c.method === 'POST' && c.path === '/iam/workspaceUser/assign-role');
    expect(assign.at(-1)!.body).toEqual({ workspace_user_id: 'wu2', role_id: 'role-editor' });
    // Upstream is the authority: the fake replaced the role, and the roster read it back.
    b = (await svc.roster(req())).find((m) => m.email === 'b@x.com')!;
    expect(b.role).toBe('member');

    // The catalog is read once and cached: a second demote is a cache hit.
    await svc.updateMemberUpstream(req(), b.id, { role: 'admin' });
    await svc.updateMemberUpstream(req(), b.id, { role: 'member' });
    expect(calls.filter((c) => c.method === 'GET' && c.path === '/iam/role').length).toBe(1);
    // …and only the catalog is consulted for a system role: the per-workspace
    // list is a fallback, not a probe on every write.
    expect(calls.filter((c) => c.path.startsWith('/iam/role/roles-workspace/')).length).toBe(0);
  });

  it('the role catalog expires after its TTL, and a name missing from the cache forces one re-read', async () => {
    await svc.list(req());
    workspaces[0]!.users!.push({ id: 'wu2', user_id: 'sub-2', type: 'MEMBER', is_active: true, roles: [], user: { email: 'b@x.com', name: 'B' } });
    const b = (await svc.roster(req())).find((m) => m.email === 'b@x.com')!;
    const reads = () => calls.filter((c) => c.method === 'GET' && c.path === '/iam/role').length;
    await svc.updateMemberUpstream(req(), b.id, { role: 'admin' });
    expect(reads()).toBe(1);
    clock += 4 * 60_000;
    await svc.updateMemberUpstream(req(), b.id, { role: 'member' });
    expect(reads()).toBe(1); // still fresh
    clock += 2 * 60_000;
    await svc.updateMemberUpstream(req(), b.id, { role: 'admin' });
    expect(reads()).toBe(2); // expired → re-read
  });

  it('a catalog the caller may not read is a 403; a catalog that is down is a 409 ROLE_UNAVAILABLE (never a 500)', async () => {
    await svc.list(req());
    workspaces[0]!.users!.push({ id: 'wu2', user_id: 'sub-2', type: 'MEMBER', is_active: true, roles: [], user: { email: 'b@x.com', name: 'B' } });
    const b = (await svc.roster(req())).find((m) => m.email === 'b@x.com')!;
    roleCatalogStatus = 403;
    // The admin role still resolves: it is on the per-workspace list (fallback).
    await svc.updateMemberUpstream(req(), b.id, { role: 'admin' });
    // The editor role is catalog-only → the upstream's refusal is the caller's 403.
    await expect(svc.updateMemberUpstream(req(), b.id, { role: 'member' })).rejects.toBeInstanceOf(ForbiddenException);
    roleCatalogStatus = 503;
    await expect(svc.updateMemberUpstream(req(), b.id, { role: 'member' })).rejects.toBeInstanceOf(ConflictException);
    // A member invite still goes out — with the workspace's default role.
    await svc.inviteUpstream(req(), { email: 'late@x.com', role: 'member' });
    const post = calls.filter((c) => c.method === 'POST' && c.path === '/iam/workspace-invitations').at(-1)!;
    expect((post.body as { role_id?: string }).role_id).toBeUndefined();
    // An admin invite still carries the admin role: it resolves from the
    // per-workspace list, which does not depend on the catalog.
    await svc.inviteUpstream(req(), { email: 'boss@x.com', role: 'admin' });
    const adm = calls.filter((c) => c.method === 'POST' && c.path === '/iam/workspace-invitations').at(-1)!;
    expect((adm.body as { role_id?: string }).role_id).toBe('role-admin');
  });

  it('a workspace_owner role upstream reads as admin here', async () => {
    workspaces[0]!.users!.push({ id: 'wu3', user_id: 'sub-3', type: 'MEMBER', is_active: true, roles: [{ id: 'role-ws-owner', name: 'workspace_owner' }], user: { email: 'c@x.com', name: 'C' } });
    await svc.list(req());
    const c = (await svc.roster(req())).find((m) => m.email === 'c@x.com')!;
    expect(c.role).toBe('admin');
  });

  it('making someone owner (or un-owning them) is a 409: ownership is not a role upstream', async () => {
    await svc.list(req());
    workspaces[0]!.users!.push({ id: 'wu2', user_id: 'sub-2', type: 'MEMBER', is_active: true, roles: [], user: { email: 'b@x.com', name: 'B' } });
    const b = (await svc.roster(req())).find((m) => m.email === 'b@x.com')!;
    await expect(svc.updateMemberUpstream(req(), b.id, { role: 'owner' })).rejects.toBeInstanceOf(ConflictException);
    expect(calls.some((c) => c.path === '/iam/workspaceUser/assign-role')).toBe(false);
  });

  it('deactivates and reactivates through PUT /workspaceUser', async () => {
    await svc.list(req());
    workspaces[0]!.users!.push({ id: 'wu2', user_id: 'sub-2', type: 'MEMBER', is_active: true, roles: [], user: { email: 'b@x.com', name: 'B' } });
    const b = (await svc.roster(req())).find((m) => m.email === 'b@x.com')!;
    const off = await svc.updateMemberUpstream(req(), b.id, { status: 'disabled' });
    expect(off.status).toBe('disabled');
    expect(calls.filter((c) => c.method === 'PUT' && c.path === '/iam/workspaceUser').at(-1)!.body).toEqual({ id: 'wu2', is_active: false });
    const on = await svc.updateMemberUpstream(req(), b.id, { status: 'active' });
    expect(on.status).toBe('active');
  });

  it('removes a member upstream first, then locally — OWNER only; an admin gets 403 (the identity service’s rule)', async () => {
    await svc.list(req());
    workspaces[0]!.users!.push(
      { id: 'wu2', user_id: 'sub-2', type: 'MEMBER', is_active: true, roles: [], user: { email: 'b@x.com', name: 'B' } },
      { id: 'wu-adm', user_id: 'sub-adm', type: 'MEMBER', is_active: true, roles: [{ id: 'role-admin', name: 'workspace_admin' }], user: { email: 'adm@x.com', name: 'Adm' } },
    );
    const roster = await svc.roster(req());
    const b = roster.find((m) => m.email === 'b@x.com')!;

    // An admin of the same workspace, acting through their own token.
    const admToken = signJwtHs256({ sub: 'sub-adm', account_id: 'acc-adm', email: 'adm@x.com', name: 'Adm', exp: 4102444800 }, SECRET);
    const admReq = (): ReqLike => ({ headers: { authorization: `Bearer ${admToken}` } });
    await expect(svc.removeMemberUpstream(admReq(), b.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    // …but that same admin CAN demote / disable.
    const off = await svc.updateMemberUpstream(admReq(), b.id, { status: 'disabled' });
    expect(off.status).toBe('disabled');

    await svc.removeMemberUpstream(req(), b.id);
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/iam/workspaceUser/member/wu2')).toBe(true);
    const gone = await db.get<{ id: string }>(sql`SELECT id FROM member WHERE id = ${b.id}`);
    expect(gone).toBeUndefined();
  });

  it('memberCount on the workspace list counts ACTIVE members only', async () => {
    workspaces[0]!.users!.push(
      { id: 'wu2', user_id: 'sub-2', type: 'MEMBER', is_active: true, roles: [], user: { email: 'b@x.com', name: 'B' } },
      { id: 'wu4', user_id: 'sub-4', type: 'MEMBER', is_active: false, roles: [], user: { email: 'd@x.com', name: 'D' } },
    );
    await svc.list(req());
    await svc.roster(req());
    const list = await svc.list(req());
    expect(list.find((w) => w.accountName === 'Mine')!.memberCount).toBe(2);
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

describe('WorkspaceService (IAM-backed) — staff of the deployment', () => {
  // Same fake as above, plus a staff person with their own workspace and a
  // customer workspace they hold no membership in.
  let db: Db;
  let svc: WorkspaceService;
  let calls: Array<{ method: string; path: string; search?: string }>;
  let workspaces: IamWorkspace[];
  // Workspace ids whose single read answers 500 (a flaky upstream row).
  let broken: Set<string>;
  // When set, POST /workspace answers this refusal instead of creating.
  let createRefusal: { status: number; body: string } | null;
  // When true, a created workspace is NOT added to the search list (the
  // upstream list lags behind the create); only its single read answers.
  let lagList: boolean;
  let lagged: IamWorkspace[];
  const STAFF_SUB = 'sub-staff';
  const staffToken = signJwtHs256({ sub: STAFF_SUB, account_id: 'acc-staff', email: 's@staff.test', name: 'Staff', exp: 4102444800 }, SECRET);
  const staffReq = (workspace?: string): ReqLike => ({
    headers: { authorization: `Bearer ${staffToken}`, ...(workspace ? { [WORKSPACE_HEADER]: workspace } : {}) },
  });
  const customerToken = signJwtHs256({ sub: SUB, account_id: IAM_ACCOUNT, email: 'a@x.com', name: 'A', exp: 4102444800 }, SECRET);
  const customerReq = (): ReqLike => ({ headers: { authorization: `Bearer ${customerToken}` } });

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    calls = [];
    broken = new Set();
    createRefusal = null;
    lagList = false;
    lagged = [];
    workspaces = [
      { id: WS_OWN, name: 'Mine', account_id: IAM_ACCOUNT, is_active: true, users: [{ id: 'wu1', user_id: SUB, type: 'OWNER', is_active: true, roles: [] }] },
      { id: 'ws-staff', name: 'Staff HQ', account_id: 'acc-staff', is_active: true, users: [{ id: 'wu-s', user_id: STAFF_SUB, type: 'OWNER', is_active: true, roles: [] }] },
      { id: 'ws-other', name: 'Other Corp', account_id: 'acc-other', is_active: true, users: [{ id: 'wu-o', user_id: 'sub-o', type: 'OWNER', is_active: true, roles: [] }] },
    ];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      calls.push({ method, path: url.pathname, search: url.search });
      if (method === 'GET' && url.pathname.startsWith('/iam/account/')) return json({ id: url.pathname.split('/').pop(), feature_flags: {} });
      if (method === 'PUT' && url.pathname.startsWith('/iam/account/')) return json({});
      if (method === 'GET' && url.pathname === '/iam/workspace/search') {
        // As the real one: a staff token sees the estate; `accountId` scopes it.
        const q = (url.searchParams.get('query') ?? '').toLowerCase();
        const acc = url.searchParams.get('accountId');
        let rows = q ? workspaces.filter((w) => w.name.toLowerCase().includes(q)) : workspaces;
        if (acc) rows = rows.filter((w) => w.account_id === acc);
        return json({ data: rows, total: rows.length, totalPages: 1 });
      }
      if (method === 'POST' && url.pathname === '/iam/workspace') {
        if (createRefusal) return new Response(createRefusal.body, { status: createRefusal.status });
        const b = JSON.parse(String(init?.body ?? '{}')) as { name: string; account_id: string };
        // Owner = whoever the bearer says (the real one does the same).
        const bearer = String((init?.headers as Record<string, string> | undefined)?.authorization ?? '');
        const claims = JSON.parse(
          Buffer.from(bearer.split('.')[1] ?? '', 'base64url').toString() || '{}',
        ) as { sub?: string };
        const n = workspaces.length + lagged.length;
        const ws: IamWorkspace = {
          id: `ws-new-${n}`,
          name: b.name,
          account_id: b.account_id,
          is_active: true,
          users: [{ id: `wu-new-${n}`, user_id: claims.sub ?? STAFF_SUB, type: 'OWNER', is_active: true, roles: [] }],
        };
        // A lagging upstream: the create answers, the LIST does not name it yet.
        (lagList ? lagged : workspaces).push(ws);
        return json(ws);
      }
      if (method === 'GET' && url.pathname.startsWith('/iam/workspace/')) {
        const id = url.pathname.split('/').pop() ?? '';
        if (broken.has(id)) return new Response('boom', { status: 500 });
        const w = [...workspaces, ...lagged].find((x) => x.id === id);
        return w ? json(w) : new Response('nf', { status: 404 });
      }
      return new Response('nope', { status: 404 });
    };
    const projection = new WorkspaceProjection(
      db,
      new IamWorkspacesClient({ baseUrl: 'https://iam.test/iam', fetchImpl }),
      { staffDomains: ['staff.test'] },
    );
    const provider = new WorkOsAuthProvider(
      db,
      { JWT_SECRET: SECRET, JWT_ISSUER: undefined, JWT_AUDIENCE: undefined, SEED_DEMO_FORM: false, ONBOARDING_WIZARD: false },
      undefined,
      projection,
    );
    svc = new WorkspaceService(db, provider, new AuthService(db, provider), projection);
  });

  afterEach(async () => {
    await db.close?.();
  });

  it('a customer searches only their own workspaces; staff get the estate too, own rows first', async () => {
    const mine = await svc.search(customerReq(), { query: '' });
    expect(mine.staff).toBe(false);
    expect(mine.rows.map((r) => r.name)).toEqual(['Mine']);

    const all = await svc.search(staffReq(), { query: '' });
    expect(all.staff).toBe(true);
    expect(all.rows.map((r) => r.name)).toEqual(['Staff HQ', 'Mine', 'Other Corp']);
    expect(all.rows[0]!.accountId).not.toBeNull(); // own: projected
    expect(all.rows[0]!.workspaceId).toBe('ws-staff'); // and it still names its upstream id
    expect(all.rows[1]!.accountId).toBeNull(); // estate: not yet
    expect(all.rows[1]!.workspaceId).toBe(WS_OWN);

    const some = await svc.search(staffReq(), { query: 'other' });
    expect(some.rows.map((r) => r.name)).toEqual(['Other Corp']);
    // Nothing was projected by LOOKING: the customer's own and the staff person's
    // own workspaces exist locally (their lists projected them); Other Corp does not.
    const other = await db.get<{ id: string }>(sql`SELECT id FROM account WHERE external_id = 'ws-other'`);
    expect(other).toBeUndefined();
    const n = await db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM account`);
    expect(Number(n!.n)).toBe(2);
  });

  it('entering an estate workspace mints an admin grant that is off the roster and never pruned; a customer cannot', async () => {
    await expect(svc.enterEstateWorkspace(customerReq(), 'ws-other')).rejects.toBeInstanceOf(ForbiddenException);

    const { accountId } = await svc.enterEstateWorkspace(staffReq(), WS_OWN);
    const row = await db.get<{ role: string; access_grant: string | null; status: string }>(
      sql`SELECT role, access_grant, status FROM member WHERE account_id = ${accountId} AND external_id = ${STAFF_SUB}`,
    );
    expect(row).toMatchObject({ role: 'admin', access_grant: 'staff', status: 'active' });
    // No onboarding stamp on the customer's account, no demo form.
    const acc = await db.get<{ onboarding_completed_at: number | null }>(sql`SELECT onboarding_completed_at FROM account WHERE id = ${accountId}`);
    expect(acc!.onboarding_completed_at).toBeNull();

    // The staff person can act in it (header check passes) and sees it in their list, marked.
    const list = await svc.list(staffReq());
    const entry = list.find((w) => w.accountId === accountId)!;
    expect(entry.role).toBe('admin');
    expect(entry.accessGrant).toBe('staff');
    // Their own workspace lists first.
    expect(list[0]!.accountName).toBe('Staff HQ');

    // The customer's roster does not show them, and the count does not include them.
    await svc.list(customerReq());
    const roster = await svc.roster(customerReq());
    expect(roster.map((m) => m.email)).toEqual(['a@x.com']);
    const mine = await svc.list(customerReq());
    expect(mine[0]!.memberCount).toBe(1);

    // A later refresh of the staff person's memberships (the estate workspace is
    // not among them) leaves the grant alone.
    await svc.refresh(staffReq());
    const again = await db.get<{ status: string }>(sql`SELECT status FROM member WHERE account_id = ${accountId} AND external_id = ${STAFF_SUB}`);
    expect(again!.status).toBe('active');
    // Idempotent.
    expect((await svc.enterEstateWorkspace(staffReq(), WS_OWN)).accountId).toBe(accountId);
  });

  it('a grant turns into a real membership when upstream later names them, and search stops listing it as estate', async () => {
    const { accountId } = await svc.enterEstateWorkspace(staffReq(), WS_OWN);
    workspaces[0]!.users!.push({ id: 'wu-s2', user_id: STAFF_SUB, type: 'MEMBER', is_active: true, roles: [] });
    await svc.refresh(staffReq());
    const row = await db.get<{ role: string; access_grant: string | null }>(
      sql`SELECT role, access_grant FROM member WHERE account_id = ${accountId} AND external_id = ${STAFF_SUB}`,
    );
    expect(row).toEqual({ role: 'member', access_grant: null });
    const res = await svc.search(staffReq(), { query: 'mine' });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.accountId).toBe(accountId);
    expect(res.rows[0]!.accessGrant).toBeNull();
  });

  it('staff search also matches the projected accounts by member email or form name, and says why', async () => {
    // The customer has been here (their list projected "Mine") and built a form.
    await svc.list(customerReq());
    const mine = await db.get<{ id: string }>(sql`SELECT id FROM account WHERE external_id = ${WS_OWN}`);
    await db.run(
      sql`INSERT INTO form (id, account_id, name, slug, config, created_at, updated_at)
          VALUES ('f-katagi', ${mine!.id}, 'Katagi Leads demo', 'katagi-leads-demo', '{}', 1, 1)`,
    );
    // Upstream knows no workspace called "katagi"; the local form does.
    const byForm = await svc.search(staffReq(), { query: 'katagi' });
    expect(byForm.rows.map((r) => r.name)).toEqual(['Mine']);
    expect(byForm.rows[0]).toMatchObject({
      workspaceId: WS_OWN,
      accountId: null,
      accessGrant: 'staff',
      localExists: true,
      hint: { kind: 'form', value: 'Katagi Leads demo' },
    });
    // By the owner's address.
    const byEmail = await svc.search(staffReq(), { query: 'a@x.c' });
    expect(byEmail.rows.map((r) => r.name)).toEqual(['Mine']);
    expect(byEmail.rows[0]!.hint).toEqual({ kind: 'email', value: 'a@x.com' });
    // By name, the upstream and the local hit are the same workspace: once, no hint.
    const byName = await svc.search(staffReq(), { query: 'mine' });
    expect(byName.rows.filter((r) => r.workspaceId === WS_OWN)).toHaveLength(1);
    expect(byName.rows[0]!.hint ?? null).toBeNull();
  });

  it('a staff refresh keeps going when one known workspace answers 500: the rest still projects', async () => {
    workspaces[2]!.users!.push({ id: 'wu-s2', user_id: STAFF_SUB, type: 'MEMBER', is_active: true, roles: [] });
    await svc.enterEstateWorkspace(staffReq(), 'ws-other');
    broken.add('ws-other');
    // A new workspace of the staff person's own account appears upstream.
    workspaces.push({ id: 'ws-staff-2', name: 'Staff Lab', account_id: 'acc-staff', is_active: true, users: [{ id: 'wu-s3', user_id: STAFF_SUB, type: 'OWNER', is_active: true, roles: [] }] });
    await svc.refresh(staffReq());
    // Not degraded: the new one is projected; the broken one is kept, not pruned.
    expect((await svc.list(staffReq())).map((w) => w.accountName).sort()).toEqual(['Other Corp', 'Staff HQ', 'Staff Lab']);
  });

  it('create projects the new workspace directly, even when the refresh cannot re-read a known one', async () => {
    workspaces[2]!.users!.push({ id: 'wu-s2', user_id: STAFF_SUB, type: 'MEMBER', is_active: true, roles: [] });
    await svc.enterEstateWorkspace(staffReq(), 'ws-other');
    broken.add('ws-other');
    const { accountId } = await svc.create(staffReq(), { name: 'Fresh' });
    const row = await db.get<{ external_id: string; name: string }>(sql`SELECT external_id, name FROM account WHERE id = ${accountId}`);
    expect(row?.name).toBe('Fresh');
    expect(workspaces.some((w) => w.id === row?.external_id)).toBe(true);
    const me = (await svc.list(staffReq())).find((w) => w.accountId === accountId);
    expect(me?.role).toBe('owner');
  });

  it('create for a regular member survives an upstream list that lags: the new row stays active', async () => {
    // The refresh inside create prunes against the upstream list; when that
    // list does not name the just-created workspace yet, the direct projection
    // must land AFTER it, or the owner row is disabled the moment it is born.
    lagList = true;
    const { accountId } = await svc.create(customerReq(), { name: 'Lagged' });
    const mine = await svc.list(customerReq());
    const row = mine.find((w) => w.accountId === accountId);
    expect(row?.status).toBe('active');
    expect(row?.role).toBe('owner');
  });

  it("create hands the identity service's refusal to the caller instead of a bare 500", async () => {
    createRefusal = { status: 422, body: JSON.stringify({ message: 'Plan limit: 1 workspace' }) };
    await expect(svc.create(staffReq(), { name: 'One more' })).rejects.toMatchObject({
      response: { error: 'WORKSPACE_CREATE_REJECTED', message: 'Plan limit: 1 workspace' },
    });
  });

  it('a staff refresh never pages the estate: own account scoped, known memberships re-read one by one', async () => {
    await svc.list(staffReq());
    const searches = calls.filter((c) => c.path === '/iam/workspace/search');
    expect(searches.length).toBeGreaterThan(0);
    // Every search the refresh made was scoped to the staff person's account.
    expect(searches.every((c) => (c.search ?? '').includes('accountId=acc-staff'))).toBe(true);
    expect(calls.some((c) => c.path.startsWith('/iam/workspace/') && c.path !== '/iam/workspace/search')).toBe(false);

    // The staff person is later made a real member of Other Corp upstream and
    // enters it through the estate: projected as a membership.
    workspaces[2]!.users!.push({ id: 'wu-s2', user_id: STAFF_SUB, type: 'MEMBER', is_active: true, roles: [] });
    await svc.enterEstateWorkspace(staffReq(), 'ws-other');
    calls.length = 0;
    await svc.refresh(staffReq());
    // Known membership outside the own account: re-read by id, still no estate paging.
    expect(calls.some((c) => c.path === '/iam/workspace/ws-other')).toBe(true);
    expect(calls.filter((c) => c.path === '/iam/workspace/search').every((c) => (c.search ?? '').includes('accountId='))).toBe(true);
    let names = (await svc.list(staffReq())).map((w) => w.accountName).sort();
    expect(names).toEqual(['Other Corp', 'Staff HQ']);

    // Revoked upstream: the re-read no longer names them, the row is disabled.
    workspaces[2]!.users = workspaces[2]!.users!.filter((u) => u.user_id !== STAFF_SUB);
    await svc.refresh(staffReq());
    names = (await svc.list(staffReq())).map((w) => w.accountName);
    expect(names).toEqual(['Staff HQ']);
  });

  it('a staff refresh that cannot re-read a known workspace keeps it (no pruning on a 500)', async () => {
    workspaces[2]!.users!.push({ id: 'wu-s2', user_id: STAFF_SUB, type: 'MEMBER', is_active: true, roles: [] });
    await svc.enterEstateWorkspace(staffReq(), 'ws-other');
    expect((await svc.list(staffReq())).map((w) => w.accountName).sort()).toEqual(['Other Corp', 'Staff HQ']);
    broken.add('ws-other');
    await svc.refresh(staffReq());
    // Absent from the refreshed list (it did not answer), but NOT disabled.
    expect((await svc.list(staffReq())).map((w) => w.accountName).sort()).toEqual(['Other Corp', 'Staff HQ']);
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
