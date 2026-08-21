/**
 * Workspace lifecycle: create, rename, refresh the list, remember the last one
 * opened.
 *
 * Two shapes behind one service. With the identity service configured
 * (`WORKSPACE_PROJECTION` present) every write goes UPSTREAM FIRST — the
 * workspace is created or renamed there, where the rest of the Dapta estate
 * reads it — and the local rows are then re-projected. Without it (forks, the
 * dev stub, tests) the same operations act on local rows only, so the product
 * behaves identically from the outside.
 *
 * Nothing here trusts a client-supplied account id: the principal comes from
 * `AuthService.resolveHost`, and the only id a client may name (`enter`) is
 * re-checked against membership before it is remembered.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Db } from '@quill/db';
import {
  createLocalWorkspace,
  findMembership,
  getAccountByExternalId,
  searchProjectedAccounts,
  getAccountMember,
  getMemberIdentity,
  getMemberUpstreamRef,
  grantStaffAccess,
  humanHasCompletedOnboarding,
  listMembers,
  listWorkspacesForIdentity,
  projectRoster,
  removeMember,
  renameAccount,
  sql,
  wouldOrphanWorkspace,
  type AccessGrant,
  type AccountRole,
  type MemberStatus,
  type MemberView,
  type WorkspaceRow,
} from '@quill/db';
import { AUTH_PROVIDER, DB, WORKSPACE_PROJECTION } from './tokens';
import type { AuthProvider, HostPrincipal, ReqLike, UpstreamIdentity } from './auth.provider';
import { AuthService } from './auth.service';
import { assertAdmin, assertCanManageTarget, assertNotSelf, assertOwner } from './permissions';
import {
  IAM_ADMIN_ROLE_NAME,
  IAM_MEMBER_ROLE_NAME,
  IamHttpError,
  IamUnavailableError,
  roleFromIam,
  userEmailOf,
  userNameOf,
} from './iam-workspaces';
import type { WorkspaceProjection } from './workspace-projection';

/** One row of `WorkspaceService.search`: a local workspace, or an estate one not yet projected. */
export interface WorkspaceSearchRow {
  /** Upstream workspace id (null for a local-only account that was never projected). */
  workspaceId: string | null;
  /** Local account id; null for an estate row (enter it through `enterEstateWorkspace`). */
  accountId: string | null;
  name: string;
  role: AccountRole;
  status: MemberStatus;
  accessGrant: AccessGrant | null;
  memberCount: number;
  /** Estate rows only: whether the workspace already has a local account (someone here opened it). */
  localExists?: boolean;
  /**
   * Staff rows matched locally by something other than the workspace name: the
   * member email or the form name that matched, so the person sees WHY this
   * workspace answered their query.
   */
  hint?: { kind: 'email' | 'form'; value: string } | null;
}

@Injectable()
export class WorkspaceService {
  private readonly log = new Logger('WorkspaceService');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AUTH_PROVIDER) private readonly provider: AuthProvider,
    @Inject(AuthService) private readonly auth: AuthService,
    @Optional() @Inject(WORKSPACE_PROJECTION) private readonly projection: WorkspaceProjection | null = null,
  ) {}

  /** The caller's upstream identity when this deployment has one, else null. */
  private async upstream(req: ReqLike): Promise<UpstreamIdentity | null> {
    if (!this.projection || !this.provider.resolveUpstream) return null;
    return this.provider.resolveUpstream(req);
  }

  /** Force a re-read from the identity service (when there is one), then list. */
  async refresh(req: ReqLike): Promise<WorkspaceRow[]> {
    const up = await this.upstream(req);
    if (up && this.projection) await this.projection.ensure(up, { force: true });
    return this.auth.listWorkspaces(req);
  }

  /**
   * Create a workspace with the caller as its owner. Upstream first when there
   * is an upstream: it is created under the caller's OWN account (the billing
   * layer the token names), never under whichever workspace they happen to be
   * viewing — that would put it on someone else's plan.
   */
  async create(req: ReqLike, input: { name: string }): Promise<{ accountId: string }> {
    const name = input.name.trim();
    if (!name) throw new BadRequestException({ error: 'BAD_REQUEST', message: 'A name is required.' });

    const p = await this.auth.resolveHost(req);
    const up = await this.upstream(req);

    if (up && this.projection) {
      let created: { id?: string } | { data?: { id?: string } } | undefined;
      try {
        created = (await this.projection.iam.createWorkspace(up.bearer, {
          name,
          account_id: up.iamAccountId,
        })) as typeof created;
      } catch (err) {
        if (err instanceof IamHttpError && err.status === 403) {
          throw new ForbiddenException({
            error: 'WORKSPACE_CREATE_FORBIDDEN',
            message: 'Your account cannot create workspaces.',
          });
        }
        throw err;
      }
      const wsId =
        (created && 'id' in created && typeof created.id === 'string' && created.id) ||
        (created && 'data' in created && created.data && typeof created.data.id === 'string' && created.data.id) ||
        null;
      // Re-project so the new workspace (and the caller's owner row in it) exists locally.
      await this.projection.ensure(up, { force: true });
      const local = wsId ? await getAccountByExternalId(this.db, wsId) : null;
      if (!local) {
        // Created upstream but not visible in the caller's memberships yet — a
        // consistency lag upstream. Surface it rather than pretend.
        throw new BadRequestException({
          error: 'WORKSPACE_NOT_VISIBLE',
          message: 'The workspace was created but is not visible yet. Try refreshing.',
        });
      }
      await this.projection.rememberLastWorkspace(up, local.id);
      return { accountId: local.id };
    }

    // Local-only path.
    const identity = await getMemberIdentity(this.db, p.accountId, p.memberId);
    const inherit = identity?.externalId
      ? await humanHasCompletedOnboarding(this.db, identity.externalId)
      : await this.accountCompletedOnboarding(p.accountId);
    const res = await createLocalWorkspace(
      this.db,
      {
        externalId: identity?.externalId ?? null,
        email: identity?.email ?? null,
        displayName: await this.displayNameOf(p),
      },
      { name, inheritOnboarding: inherit },
    );
    return { accountId: res.accountId };
  }

  /** Rename the workspace the caller is acting in (admin/owner). */
  async rename(req: ReqLike, input: { name: string }): Promise<{ accountId: string; name: string }> {
    const name = input.name.trim();
    if (!name) throw new BadRequestException({ error: 'BAD_REQUEST', message: 'A name is required.' });
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);

    const up = await this.upstream(req);
    if (up && this.projection) {
      const row = await this.db.get<{ external_id: string | null }>(
        sql`SELECT external_id FROM account WHERE id = ${p.accountId} LIMIT 1`,
      );
      const wsId = row?.external_id ?? null;
      if (wsId && !wsId.startsWith('local:') && !wsId.startsWith('dev:') && !wsId.startsWith('legacy:')) {
        await this.projection.iam.updateWorkspace(up.bearer, wsId, { name });
        this.projection.invalidate(up.sub);
      }
    }
    await renameAccount(this.db, p.accountId, name);
    return { accountId: p.accountId, name };
  }

  /**
   * The caller is about to open `accountId`. Verifies membership (from the
   * home identity, exactly like the header check) and remembers the choice
   * upstream so the Dapta app opens the same workspace next time.
   */
  async enter(req: ReqLike, accountId: string): Promise<{ ok: true }> {
    const home = await this.provider.resolveHost(req);
    const identity = await getMemberIdentity(this.db, home.accountId, home.memberId);
    const membership = identity ? await findMembership(this.db, identity, accountId) : null;
    if (!membership) {
      throw new ForbiddenException({
        error: 'WORKSPACE_FORBIDDEN',
        message: 'You are not a member of that workspace.',
      });
    }
    const up = await this.upstream(req);
    if (up && this.projection) await this.projection.rememberLastWorkspace(up, accountId);
    return { ok: true };
  }

  /** Every workspace the caller can enter — the projection, never upstream directly. */
  async list(req: ReqLike): Promise<WorkspaceRow[]> {
    const home = await this.provider.resolveHost(req);
    const identity = await getMemberIdentity(this.db, home.accountId, home.memberId);
    return identity ? listWorkspacesForIdentity(this.db, identity) : [];
  }

  // --- Staff: the whole estate ----------------------------------------------

  /** True when the caller's email domain is one the deployment lists as staff (identity-backed only). */
  async isStaff(req: ReqLike): Promise<boolean> {
    const up = await this.upstream(req);
    return !!(up && this.projection && this.projection.isStaff(up.email));
  }

  /**
   * Type-to-find over the workspaces the caller may enter.
   *
   * For everyone: their own list (the projection), filtered by name. For the
   * deployment's STAFF, additionally the whole estate as the identity service
   * answers its search (the same call the Dapta app's sidebar makes), so a
   * workspace they never opened here is one keystroke away. Rows carry the
   * local `accountId` when the caller already holds a row there (a membership
   * or an earlier grant); otherwise `null`, and entering it goes through
   * `enterEstateWorkspace`, which mints the grant.
   */
  async search(
    req: ReqLike,
    input: { query: string; page?: number; limit?: number },
  ): Promise<{ rows: WorkspaceSearchRow[]; staff: boolean; total: number; totalPages: number; page: number }> {
    const q = input.query.trim().toLowerCase();
    const mine = await this.list(req);
    const mineFiltered = q ? mine.filter((w) => w.accountName.toLowerCase().includes(q)) : mine;
    const own: WorkspaceSearchRow[] = mineFiltered.map((w) => ({
      workspaceId: w.workspaceId,
      accountId: w.accountId,
      name: w.accountName,
      role: w.role,
      status: w.status,
      accessGrant: w.accessGrant,
      memberCount: w.memberCount,
    }));

    const up = await this.upstream(req);
    if (!up || !this.projection || !this.projection.isStaff(up.email)) {
      return { rows: own, staff: false, total: own.length, totalPages: 1, page: 1 };
    }

    // Staff: two sources, in parallel. (1) The accounts THIS database already
    // projected, matched by workspace name, member email or form name: the
    // identity service knows workspaces by name only, and staff rarely hold
    // the name; they hold a form link or the customer's address. (2) The
    // estate page from upstream (name match). Both minus what the own list
    // already shows, never a workspace twice. Own rows first: they are the
    // ones the person actually works in; then the local hits (Forms users,
    // the ones staff come here for); then the rest of the estate.
    const firstPage = !input.page || input.page <= 1;
    const [localHits, page] = await Promise.all([
      firstPage && q ? searchProjectedAccounts(this.db, q, { limit: input.limit }) : Promise.resolve([]),
      this.projection.iam.searchWorkspaces(up.bearer, { query: q, page: input.page, limit: input.limit }),
    ]);
    const seen = new Set<string>();
    for (const w of mineFiltered) if (w.workspaceId) seen.add(w.workspaceId);
    const estate: WorkspaceSearchRow[] = [];
    for (const hit of localHits) {
      if (seen.has(hit.workspaceId)) continue;
      seen.add(hit.workspaceId);
      estate.push({
        workspaceId: hit.workspaceId,
        accountId: null,
        name: hit.name,
        role: 'admin',
        status: 'active',
        accessGrant: 'staff',
        memberCount: hit.memberCount,
        localExists: true,
        hint: hit.hint,
      });
    }
    for (const ws of page.rows) {
      if (seen.has(ws.id)) continue;
      seen.add(ws.id);
      const local = await getAccountByExternalId(this.db, ws.id);
      estate.push({
        workspaceId: ws.id,
        accountId: null,
        name: ws.name,
        role: 'admin',
        status: 'active',
        accessGrant: 'staff',
        memberCount: (ws.users ?? []).filter((u) => u.is_active !== false).length,
        localExists: !!local,
      });
    }
    return {
      rows: [...(firstPage ? own : []), ...estate],
      staff: true,
      total: page.total,
      totalPages: page.totalPages,
      page: page.page,
    };
  }

  /**
   * A STAFF caller is about to open an estate workspace they hold no upstream
   * membership in. The workspace is re-read upstream (never trusted from the
   * client), projected locally if unseen (no onboarding stamp, no demo form,
   * no signup event) and the caller gets an `admin` row marked
   * `access_grant = 'staff'`. A caller who DOES hold a membership there is
   * simply projected as such. Returns the local account id to switch into.
   */
  async enterEstateWorkspace(req: ReqLike, workspaceId: string): Promise<{ accountId: string }> {
    const up = await this.upstream(req);
    if (!up || !this.projection) {
      throw new ForbiddenException({ error: 'FORBIDDEN', message: 'Requires the identity service.' });
    }
    if (!this.projection.isStaff(up.email)) {
      throw new ForbiddenException({ error: 'WORKSPACE_FORBIDDEN', message: 'You are not a member of that workspace.' });
    }
    let ws;
    try {
      ws = await this.projection.iam.getWorkspace(up.bearer, workspaceId);
    } catch (err) {
      if (err instanceof IamHttpError && (err.status === 403 || err.status === 404)) {
        throw new ForbiddenException({ error: 'WORKSPACE_FORBIDDEN', message: 'You are not a member of that workspace.' });
      }
      throw err;
    }
    if (!ws || ws.is_active === false) {
      throw new ForbiddenException({ error: 'WORKSPACE_FORBIDDEN', message: 'You are not a member of that workspace.' });
    }
    const identity = { externalId: up.sub, email: up.email, displayName: up.displayName };
    const me = (ws.users ?? []).find((u) => u.user_id === up.sub);
    let accountId: string;
    if (me && me.is_active !== false) {
      // A real membership upstream: project it as such, no grant needed. This
      // ONE workspace, directly: a staff refresh does not read the estate, so
      // a membership in someone else's account is not found any other way.
      await this.projection.projectOne(up, ws);
      const local = await getAccountByExternalId(this.db, ws.id);
      if (!local) throw new BadRequestException({ error: 'WORKSPACE_NOT_VISIBLE', message: 'Try refreshing.' });
      accountId = local.id;
    } else {
      accountId = (
        await grantStaffAccess(this.db, identity, {
          workspaceId: ws.id,
          workspaceName: ws.name,
          iamAccountId: ws.account_id ?? null,
        })
      ).accountId;
      this.log.log(`staff grant: ${up.email ?? up.sub} entered workspace ${ws.id} as admin`);
    }
    await this.projection.rememberLastWorkspace(up, accountId);
    return { accountId };
  }

  // --- Members via the identity service ------------------------------------

  /** True when this deployment routes member management upstream. */
  async hasUpstream(req: ReqLike): Promise<boolean> {
    return (await this.upstream(req)) !== null;
  }

  /** The upstream workspace id behind a local account, or null when it has none. */
  private async upstreamWorkspaceId(accountId: string): Promise<string | null> {
    const row = await this.db.get<{ external_id: string | null }>(
      sql`SELECT external_id FROM account WHERE id = ${accountId} LIMIT 1`,
    );
    const id = row?.external_id ?? null;
    if (!id || id.startsWith('local:') || id.startsWith('dev:') || id.startsWith('legacy:')) return null;
    return id;
  }

  /**
   * The roster, re-projected from the upstream workspace's `users[]` first so an
   * admin sees who is REALLY in (someone added or removed from the Dapta app
   * shows up here without a login of their own).
   */
  async roster(req: ReqLike): Promise<MemberView[]> {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const up = await this.upstream(req);
    const wsId = up ? await this.upstreamWorkspaceId(p.accountId) : null;
    if (up && this.projection && wsId) {
      try {
        const ws = await this.projection.iam.getWorkspace(up.bearer, wsId);
        await projectRoster(
          this.db,
          p.accountId,
          (ws.users ?? []).map((u) => ({
            externalId: u.user_id,
            email: userEmailOf(u),
            displayName: userNameOf(u),
            role: roleFromIam(u),
            active: u.is_active !== false,
            workspaceUserId: u.id,
          })),
        );
      } catch (err) {
        // A roster read that fails upstream still shows what is local.
        this.logWarn(`roster sync failed for ${p.accountId}: ${String(err)}`);
      }
    }
    return listMembers(this.db, p.accountId);
  }

  /**
   * The upstream role id behind one of our roles, resolved by NAME (ids differ
   * per environment): admin → `workspace_admin`, member → `workspace_editor`.
   * `owner` is not a role upstream but a membership TYPE, and nothing this
   * product calls can transfer it → 409.
   *
   * The upstream applies its own authorization: a 401/403 while reading the
   * catalog is THEM refusing the caller (→ 403 here); any other failure — the
   * role missing, a 4xx, the service unreachable — is "this role cannot be
   * resolved right now" (→ 409 `ROLE_UNAVAILABLE`), never a crash.
   */
  private async upstreamRoleId(bearer: string, wsId: string, role: 'admin' | 'member'): Promise<string> {
    const name = role === 'admin' ? IAM_ADMIN_ROLE_NAME : IAM_MEMBER_ROLE_NAME;
    let id: string | null;
    try {
      id = await this.projection!.iam.roleIdByName(bearer, name, wsId);
    } catch (err) {
      if (err instanceof IamHttpError && (err.status === 401 || err.status === 403)) {
        throw new ForbiddenException({ error: 'FORBIDDEN', message: 'The identity service refused this change.' });
      }
      if (err instanceof IamHttpError || err instanceof IamUnavailableError) {
        this.logWarn(`role catalog read failed for ${wsId}: ${String(err)}`);
        id = null;
      } else {
        throw err;
      }
    }
    if (!id) {
      throw new ConflictException({
        error: 'ROLE_UNAVAILABLE',
        message: `The ${role} role is not available upstream.`,
      });
    }
    return id;
  }

  /**
   * Invite by email through the identity service. The invitation, its email,
   * and its acceptance all live upstream; the person appears in the roster
   * once they accept (next roster read). Admin → the upstream `workspace_admin`
   * role; member → `workspace_editor`, so what the invitee lands with is what
   * the inviter picked, in both apps.
   */
  async inviteUpstream(
    req: ReqLike,
    input: { email: string; role?: 'admin' | 'member' },
  ): Promise<MemberView> {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const up = await this.upstream(req);
    const wsId = await this.upstreamWorkspaceId(p.accountId);
    if (!up || !this.projection || !wsId) {
      throw new ConflictException({ error: 'NO_UPSTREAM', message: 'This workspace has no identity service behind it.' });
    }
    const email = input.email.trim().toLowerCase();
    // Admin MUST carry the admin role (an admin invite that lands as a plain
    // member is a silent privilege mismatch). Member SHOULD carry the editor
    // role; when the catalog cannot be read the invitation still goes out with
    // the workspace's default, as it did before the editor role was sent.
    let roleId: string | undefined;
    if (input.role === 'admin') {
      roleId = await this.upstreamRoleId(up.bearer, wsId, 'admin');
    } else {
      try {
        roleId = await this.upstreamRoleId(up.bearer, wsId, 'member');
      } catch (err) {
        if (!(err instanceof ConflictException)) throw err;
        this.logWarn(`member invite for ${wsId} sent without role_id: editor role unavailable`);
      }
    }
    try {
      const inv = await this.projection.iam.createInvitation(up.bearer, {
        invited_email: email,
        workspace_id: wsId,
        ...(roleId ? { role_id: roleId } : {}),
      });
      // Shaped like a roster row so the caller's contract does not fork: the
      // invitation is `invited` until upstream turns it into a membership.
      return {
        id: inv?.id ? `invitation:${inv.id}` : `invitation:${email}`,
        email,
        displayName: null,
        handle: null,
        avatarUrl: null,
        role: input.role === 'admin' ? 'admin' : 'member',
        status: 'invited',
        createdAt: Date.now(),
        accessGrant: null,
      };
    } catch (err) {
      // 409, or a 400 whose body says "already": the address is taken. Any
      // other 400 is the upstream refusing the payload (the role, the address
      // shape) and is reported as such — a retry with the same input will
      // not help, and "already a member" would be a lie.
      if (err instanceof IamHttpError && err.status === 409) {
        throw new ConflictException({ error: 'EMAIL_TAKEN', message: 'That address is already invited or a member.' });
      }
      if (err instanceof IamHttpError && err.status === 400) {
        if (/already|exist|duplicate|invited|member/i.test(err.body)) {
          throw new ConflictException({ error: 'EMAIL_TAKEN', message: 'That address is already invited or a member.' });
        }
        throw new BadRequestException({ error: 'INVALID', message: 'The identity service refused that invitation.' });
      }
      throw err;
    }
  }

  /** Pending invitations, from upstream. Empty when there is no upstream. */
  async listInvitations(req: ReqLike): Promise<Array<{ id: string; email: string; status: string; createdAt: string | null; expiresAt: string | null }>> {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const up = await this.upstream(req);
    const wsId = up ? await this.upstreamWorkspaceId(p.accountId) : null;
    if (!up || !this.projection || !wsId) return [];
    const rows = await this.projection.iam.listInvitations(up.bearer, wsId, 'PENDING');
    return rows.map((r) => ({
      id: r.id,
      email: r.invited_email,
      status: r.status,
      createdAt: r.created_at ?? null,
      expiresAt: r.expires_at ?? null,
    }));
  }

  async resendInvitation(req: ReqLike, invitationId: string): Promise<{ ok: true }> {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const up = await this.upstream(req);
    const wsId = up ? await this.upstreamWorkspaceId(p.accountId) : null;
    if (!up || !this.projection || !wsId) {
      throw new ConflictException({ error: 'NO_UPSTREAM', message: 'This workspace has no identity service behind it.' });
    }
    // Scope: only an invitation of THIS workspace may be resent from here.
    const mine = await this.projection.iam.listInvitations(up.bearer, wsId, 'PENDING');
    if (!mine.some((i) => i.id === invitationId)) {
      throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    }
    await this.projection.iam.resendInvitation(up.bearer, invitationId);
    return { ok: true };
  }

  /**
   * Change a member upstream: promote (assign `workspace_admin`), demote (assign
   * `workspace_editor` — roles are replaced, so this is how "member" is said),
   * enable/disable. Ownership is a membership TYPE upstream, not a role, and
   * nothing this product calls transfers it → 409.
   */
  async updateMemberUpstream(
    req: ReqLike,
    memberId: string,
    input: { role?: 'owner' | 'admin' | 'member'; status?: 'active' | 'invited' | 'disabled' },
  ): Promise<MemberView> {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    assertNotSelf(p, memberId);
    const target = await getAccountMember(this.db, p.accountId, memberId);
    if (!target) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    assertCanManageTarget(p, target, { toRole: input.role });
    const up = await this.upstream(req);
    const wsId = up ? await this.upstreamWorkspaceId(p.accountId) : null;
    const ref = await getMemberUpstreamRef(this.db, p.accountId, memberId);
    if (!up || !this.projection || !wsId || !ref?.workspaceUserId) {
      throw new ConflictException({ error: 'NO_UPSTREAM', message: 'This member is not managed by the identity service.' });
    }
    // The last-owner guard runs BEFORE anything is written upstream: an
    // upstream write that then 409s locally would leave the two disagreeing.
    const demoting = input.role !== undefined && input.role !== 'owner' && target.role === 'owner';
    const disabling = input.status !== undefined && input.status !== 'active' && target.role === 'owner';
    if ((demoting || disabling) && (await wouldOrphanWorkspace(this.db, p.accountId, memberId))) {
      throw new ConflictException({ error: 'LAST_OWNER', message: 'A workspace must keep at least one owner.' });
    }
    if (input.role !== undefined && input.role !== target.role) {
      if (input.role === 'owner' || target.role === 'owner') {
        // OWNER is the membership type upstream; there is no call that changes it.
        throw new ConflictException({
          error: 'NOT_SUPPORTED_UPSTREAM',
          message: 'Ownership is transferred from the Dapta app.',
        });
      }
      const roleId = await this.upstreamRoleId(up.bearer, wsId, input.role);
      try {
        await this.projection.iam.assignRole(up.bearer, ref.workspaceUserId, roleId);
      } catch (err) {
        // The upstream applies its own authorization: a 401/403 is THEM
        // refusing the caller; any other 4xx is them refusing THIS role for
        // THIS membership. Surface both as such, not as a crash.
        if (err instanceof IamHttpError && (err.status === 401 || err.status === 403)) {
          throw new ForbiddenException({ error: 'FORBIDDEN', message: 'The identity service refused this change.' });
        }
        if (err instanceof IamHttpError && err.status >= 400 && err.status < 500) {
          throw new ConflictException({ error: 'ROLE_UNAVAILABLE', message: `The ${input.role} role was refused upstream.` });
        }
        throw err;
      }
    }
    if (input.status !== undefined && input.status !== target.status) {
      if (input.status === 'invited') {
        throw new BadRequestException({ error: 'BAD_REQUEST', message: 'Cannot set a member back to invited.' });
      }
      await this.projection.iam.setWorkspaceUserActive(up.bearer, ref.workspaceUserId, input.status === 'active');
    }
    if (ref.externalId) this.projection.invalidate(ref.externalId);
    await this.roster(req);
    return (await getAccountMember(this.db, p.accountId, memberId)) ?? target;
  }

  /**
   * Remove a member upstream, then locally. Idempotent. OWNER-only, the same
   * rule the Dapta app applies (an admin may invite, promote, demote and
   * disable, but not remove) — kept identical so a person managing a workspace
   * from either app meets the same door. The one exception is a row that is
   * still `invited` (a pre-0015 local invitation nobody accepted): retracting
   * an invitation is the inviter's call, so an admin may.
   */
  async removeMemberUpstream(req: ReqLike, memberId: string): Promise<{ ok: true }> {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    assertNotSelf(p, memberId);
    const target = await getAccountMember(this.db, p.accountId, memberId);
    if (!target) {
      assertOwner(p); // an unknown id is a "remove" in intent; hold it to the owner rule
      return { ok: true };
    }
    if (target.status !== 'invited') assertOwner(p);
    assertCanManageTarget(p, target);
    if (await wouldOrphanWorkspace(this.db, p.accountId, memberId)) {
      throw new ConflictException({ error: 'LAST_OWNER', message: 'A workspace must keep at least one owner.' });
    }
    const up = await this.upstream(req);
    const ref = await getMemberUpstreamRef(this.db, p.accountId, memberId);
    if (up && this.projection && ref?.workspaceUserId) {
      try {
        await this.projection.iam.removeWorkspaceUser(up.bearer, ref.workspaceUserId);
      } catch (err) {
        if (!(err instanceof IamHttpError && err.status === 404)) throw err;
      }
      if (ref.externalId) this.projection.invalidate(ref.externalId);
    } else if (up && this.projection && ref?.externalId) {
      // Known to the identity service (has a subject) but we hold no upstream
      // membership id to remove: a local delete would be undone by their next
      // login. Refuse rather than pretend.
      throw new ConflictException({ error: 'NO_UPSTREAM', message: 'This member is not managed by the identity service.' });
    }
    const res = await removeMember(this.db, p.accountId, memberId);
    if (!res.ok) throw new ConflictException({ error: res.reason, message: res.message ?? 'Conflict.' });
    return { ok: true };
  }

  private logWarn(message: string): void {
    this.log.warn(message);
  }

  private async accountCompletedOnboarding(accountId: string): Promise<boolean> {
    const r = await this.db.get<{ id: string }>(
      sql`SELECT id FROM account WHERE id = ${accountId} AND onboarding_completed_at IS NOT NULL LIMIT 1`,
    );
    return !!r;
  }

  private async displayNameOf(p: HostPrincipal): Promise<string | null> {
    const r = await this.db.get<{ display_name: string | null }>(
      sql`SELECT display_name FROM member WHERE id = ${p.memberId} AND account_id = ${p.accountId} LIMIT 1`,
    );
    return r?.display_name ?? null;
  }
}
