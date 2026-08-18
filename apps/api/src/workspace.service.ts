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
  getAccountMember,
  getMemberIdentity,
  getMemberUpstreamRef,
  humanHasCompletedOnboarding,
  listMembers,
  listWorkspacesForIdentity,
  projectRoster,
  removeMember,
  renameAccount,
  sql,
  wouldOrphanWorkspace,
  type MemberView,
  type WorkspaceRow,
} from '@quill/db';
import { AUTH_PROVIDER, DB, WORKSPACE_PROJECTION } from './tokens';
import type { AuthProvider, HostPrincipal, ReqLike, UpstreamIdentity } from './auth.provider';
import { AuthService } from './auth.service';
import { assertAdmin, assertCanManageTarget, assertNotSelf } from './permissions';
import { IAM_ADMIN_ROLE_NAME, IamHttpError, roleFromIam, userEmailOf, userNameOf } from './iam-workspaces';
import type { WorkspaceProjection } from './workspace-projection';

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
   * Invite by email through the identity service. The invitation, its email,
   * and its acceptance all live upstream; the person appears in the roster
   * once they accept (next roster read). Admin → the upstream `workspace_admin`
   * role; member → the workspace's default.
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
    let roleId: string | undefined;
    if (input.role === 'admin') {
      const roles = await this.projection.iam.listRoles(up.bearer, wsId);
      roleId = roles.find((r) => r.name === IAM_ADMIN_ROLE_NAME)?.id;
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
      };
    } catch (err) {
      if (err instanceof IamHttpError && (err.status === 409 || err.status === 400)) {
        throw new ConflictException({ error: 'EMAIL_TAKEN', message: 'That address is already invited or a member.' });
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
   * Change a member upstream: promote to admin (assign `workspace_admin`),
   * enable/disable. Demoting to member is not expressible upstream (roles are
   * assigned, never removed, through the API this product has) → 409.
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
      if (input.role === 'admin') {
        const roles = await this.projection.iam.listRoles(up.bearer, wsId);
        const roleId = roles.find((r) => r.name === IAM_ADMIN_ROLE_NAME)?.id;
        if (!roleId) throw new ConflictException({ error: 'ROLE_UNAVAILABLE', message: 'The admin role is not available upstream.' });
        await this.projection.iam.assignRole(up.bearer, ref.workspaceUserId, roleId);
      } else {
        throw new ConflictException({
          error: 'NOT_SUPPORTED_UPSTREAM',
          message: 'Change this role from the Dapta app.',
        });
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

  /** Remove a member upstream, then locally. Idempotent. */
  async removeMemberUpstream(req: ReqLike, memberId: string): Promise<{ ok: true }> {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    assertNotSelf(p, memberId);
    const target = await getAccountMember(this.db, p.accountId, memberId);
    if (!target) return { ok: true };
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
