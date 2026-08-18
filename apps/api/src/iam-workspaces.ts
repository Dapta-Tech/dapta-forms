/**
 * The identity service's workspace API, as this product consumes it.
 *
 * Every call forwards the CALLER's bearer token — the same platform JWT the
 * auth provider validated — so the identity service applies its own
 * authorization and this client never holds a privileged credential. Nothing
 * per tenant is cached or persisted here — `workspace-projection.ts` decides
 * what to keep — with one deliberate exception: the SYSTEM role catalog (the
 * same rows for every caller, filtered of anything workspace-scoped), kept for
 * a few minutes so role writes do not re-read it every time.
 *
 * Only the shapes this product reads are typed. Upstream returns far more per
 * row (phone numbers, plans, stripe ids); it is dropped at the boundary.
 *
 * Kept behind `IAM_BASE_URL`: unset (every fork, plain local dev) means this
 * client is never constructed and the auth provider keeps its pre-0015 shape.
 */

import type { AccountRole } from '@quill/db';

/** How the upstream classifies a membership row. */
export type IamMembershipType = 'OWNER' | 'MEMBER';

/**
 * One membership row. The upstream ships TWO shapes of it — the search list
 * nests the role under `role` and the person under `user`; the workspace
 * detail flattens both — so every field that differs is optional here and read
 * through the accessors below, never directly.
 */
export interface IamWorkspaceUser {
  /** `workspace_users.id` — what removal / re-roling is keyed on. */
  id: string;
  user_id: string;
  type: IamMembershipType;
  is_active: boolean;
  /** Roles assigned to this membership. Empty for an OWNER (implicit admin). */
  roles?: Array<{ role_id?: string; id?: string; name?: string; role?: { name?: string } | null }> | null;
  user?: { email?: string | null; name?: string | null } | null;
  email?: string | null;
  name?: string | null;
}

/** The person's email on a membership row, whichever shape it arrived in. */
export function userEmailOf(u: IamWorkspaceUser): string | null {
  return u.email ?? u.user?.email ?? null;
}

/** The person's display name on a membership row, whichever shape it arrived in. */
export function userNameOf(u: IamWorkspaceUser): string | null {
  return u.name ?? u.user?.name ?? null;
}

export interface IamWorkspace {
  id: string;
  name: string;
  description?: string | null;
  account_id: string;
  is_active: boolean;
  isOwner?: boolean;
  users?: IamWorkspaceUser[];
}

export interface IamAccount {
  id: string;
  name?: string | null;
  feature_flags?: Record<string, unknown> | null;
}

export interface IamRole {
  id: string;
  name: string;
  is_system?: boolean;
  workspace_id?: string | null;
}

export interface IamInvitation {
  id: string;
  workspace_id: string;
  invited_email: string;
  role?: string | null;
  status: string;
  created_at?: string;
  expires_at?: string | null;
}

/** The upstream system role this product ASSIGNS for `admin`. */
export const IAM_ADMIN_ROLE_NAME = 'workspace_admin';
/**
 * The upstream system role this product ASSIGNS for `member` (demote / invite as
 * member). Roles upstream are replaced, never removed, so "make them a member"
 * means "give them the editor role" — the same thing the Dapta app's role dialog
 * does when it picks a non-admin role.
 */
export const IAM_MEMBER_ROLE_NAME = 'workspace_editor';
/** Every upstream role name that READS as `admin` here (assigned by us or by the Dapta app). */
export const IAM_ADMIN_ROLE_NAMES: readonly string[] = ['workspace_admin', 'workspace_owner'];

/**
 * Upstream membership → local account role.
 *
 *   OWNER                                              → owner
 *   MEMBER holding `workspace_admin` / `workspace_owner` → admin   (manages members, branding, integrations)
 *   MEMBER with any other / no role                    → member  (creates and edits forms, reads results)
 *
 * One function on purpose: when the identity service grows a `forms` component
 * in its permission catalog, this is the only place that changes.
 */
export function roleFromIam(wu: Pick<IamWorkspaceUser, 'type' | 'roles'>): AccountRole {
  if (wu.type === 'OWNER') return 'owner';
  const admin = (wu.roles ?? []).some((r) => {
    const name = r.name ?? r.role?.name;
    return typeof name === 'string' && IAM_ADMIN_ROLE_NAMES.includes(name);
  });
  return admin ? 'admin' : 'member';
}

/** A membership of `sub` in one workspace, or null when they hold none. */
export function membershipOf(ws: IamWorkspace, sub: string): IamWorkspaceUser | null {
  return (ws.users ?? []).find((u) => u.user_id === sub) ?? null;
}

export class IamHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly method: string,
    public readonly path: string,
    public readonly body: string,
  ) {
    super(`IAM ${method} ${path} → HTTP ${status}`);
    this.name = 'IamHttpError';
  }
}

export class IamUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IamUnavailableError';
  }
}

const IAM_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 100;
/** Guard against an upstream that pages forever; a person is in far fewer than this. */
const MAX_PAGES = 20;
/**
 * The system role catalog changes when the identity service deploys, not per
 * request. Cached per client instance (system rows only — see `isSystemRole`);
 * a name that is not in the cached copy forces one re-read before giving up
 * (see `roleIdByName`).
 */
const ROLE_CATALOG_TTL_MS = 5 * 60_000;

/** A role of the identity service itself, not one a workspace defined. */
export function isSystemRole(r: IamRole): boolean {
  return r.is_system !== false && !r.workspace_id;
}

export interface IamWorkspacesClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Test seam; defaults to `Date.now`. */
  now?: () => number;
}

export class IamWorkspacesClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private roleCatalog: { at: number; roles: IamRole[] } | null = null;

  constructor(opts: IamWorkspacesClientOptions) {
    this.base = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? IAM_TIMEOUT_MS;
    this.now = opts.now ?? Date.now;
  }

  // --- Accounts ------------------------------------------------------------

  getAccount(bearer: string, accountId: string): Promise<IamAccount> {
    return this.call<IamAccount>(bearer, 'GET', `/account/${encodeURIComponent(accountId)}`);
  }

  /**
   * Remember the workspace this person opened last. Written on the person's OWN
   * account (the token's `account_id`) even when the workspace belongs to
   * someone else's — that is where the Dapta app reads it from at bootstrap, so
   * the "last opened" answer is shared in both directions.
   */
  async setLastWorkspace(
    bearer: string,
    accountId: string,
    workspaceId: string,
    currentFlags: Record<string, unknown> | null | undefined,
  ): Promise<void> {
    await this.call(bearer, 'PUT', `/account/${encodeURIComponent(accountId)}`, {
      feature_flags: { ...(currentFlags ?? {}), last_workspace: workspaceId },
    });
  }

  // --- Workspaces ----------------------------------------------------------

  /**
   * Every workspace `sub` is a member of. The upstream search is NOT "mine" —
   * for some callers it returns every workspace in the estate — so membership is
   * decided here, from `users[]`, never from presence in the list.
   */
  async listMyWorkspaces(bearer: string, sub: string): Promise<IamWorkspace[]> {
    const out: IamWorkspace[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await this.call<{ data?: IamWorkspace[]; totalPages?: number; total?: number }>(
        bearer,
        'GET',
        `/workspace/search?page=${page}&limit=${PAGE_SIZE}`,
      );
      const rows = Array.isArray(res?.data) ? res.data : [];
      for (const ws of rows) {
        if (!ws || typeof ws.id !== 'string' || seen.has(ws.id)) continue;
        seen.add(ws.id);
        if (ws.is_active === false) continue;
        const me = membershipOf(ws, sub);
        if (me || ws.isOwner === true) out.push(ws);
      }
      const totalPages = typeof res?.totalPages === 'number' ? res.totalPages : 1;
      if (rows.length < PAGE_SIZE || page >= totalPages) break;
    }
    return out;
  }

  /**
   * One page of the workspace search as the upstream answers it, membership NOT
   * applied: for the deployment's staff the identity service answers with the
   * whole estate, and that is exactly the list they get to search (the same
   * call the Dapta app's sidebar makes, `?query=`). Callers decide who may
   * see it; this only fetches.
   */
  async searchWorkspaces(
    bearer: string,
    opts: { query?: string; page?: number; limit?: number } = {},
  ): Promise<{ rows: IamWorkspace[]; total: number; totalPages: number; page: number }> {
    const page = Math.max(1, Math.floor(opts.page ?? 1));
    const limit = Math.min(PAGE_SIZE, Math.max(1, Math.floor(opts.limit ?? 20)));
    const q = (opts.query ?? '').trim();
    const res = await this.call<{ data?: IamWorkspace[]; total?: number; totalPages?: number }>(
      bearer,
      'GET',
      `/workspace/search?page=${page}&limit=${limit}${q ? `&query=${encodeURIComponent(q)}` : ''}`,
    );
    const rows = (Array.isArray(res?.data) ? res.data : []).filter(
      (ws) => ws && typeof ws.id === 'string' && ws.is_active !== false,
    );
    return {
      rows,
      total: typeof res?.total === 'number' ? res.total : rows.length,
      totalPages: typeof res?.totalPages === 'number' ? res.totalPages : 1,
      page,
    };
  }

  getWorkspace(bearer: string, workspaceId: string): Promise<IamWorkspace> {
    return this.call<IamWorkspace>(bearer, 'GET', `/workspace/${encodeURIComponent(workspaceId)}`);
  }

  createWorkspace(
    bearer: string,
    input: { name: string; description?: string; timezone?: string; account_id: string },
  ): Promise<IamWorkspace> {
    return this.call<IamWorkspace>(bearer, 'POST', '/workspace', {
      name: input.name,
      description: input.description ?? '',
      timezone: input.timezone ?? 'UTC',
      account_id: input.account_id,
    });
  }

  updateWorkspace(
    bearer: string,
    workspaceId: string,
    input: { name: string; description?: string },
  ): Promise<IamWorkspace> {
    return this.call<IamWorkspace>(bearer, 'PUT', `/workspace/${encodeURIComponent(workspaceId)}`, {
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
    });
  }

  // --- Roles + members -----------------------------------------------------

  /**
   * The roles offered for ONE workspace: `workspace_admin` plus that workspace's
   * custom roles. This is what the Dapta app's role dialog lists; note it does
   * NOT include the other system roles (`workspace_editor`, …).
   */
  async listRoles(bearer: string, workspaceId: string): Promise<IamRole[]> {
    const res = await this.call<IamRole[] | { data?: IamRole[] }>(
      bearer,
      'GET',
      `/role/roles-workspace/${encodeURIComponent(workspaceId)}`,
    );
    return Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
  }

  /**
   * The SYSTEM role catalog. `GET /role` answers with the system roles plus
   * every custom role the caller can see; only the system rows are kept (and
   * cached, for `ROLE_CATALOG_TTL_MS`) — the client is a process singleton
   * shared by every tenant, so nothing workspace-scoped may sit in it. Ids
   * differ per environment, so roles are always resolved by NAME from this
   * list, never hardcoded.
   */
  async listSystemRoles(bearer: string, opts: { force?: boolean } = {}): Promise<IamRole[]> {
    if (this.roleCatalog && this.catalogFresh() && !opts.force) return this.roleCatalog.roles;
    const res = await this.call<IamRole[] | { data?: IamRole[] }>(bearer, 'GET', '/role');
    const all = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
    const roles = all.filter(isSystemRole);
    this.roleCatalog = { at: this.now(), roles };
    return roles;
  }

  private catalogFresh(): boolean {
    return !!this.roleCatalog && this.now() - this.roleCatalog.at < ROLE_CATALOG_TTL_MS;
  }

  /**
   * The id of the SYSTEM role called `name`. The cached catalog is consulted
   * first (no round trip on a hit); a miss re-reads it once — a role added
   * since the cache was filled — and, when `workspaceId` is given, falls back
   * to that workspace's own list, the one place `workspace_admin` is
   * guaranteed to appear even for a caller who cannot read `/role`. A custom
   * role that happens to share the name never wins over the system one.
   */
  async roleIdByName(bearer: string, name: string, workspaceId?: string): Promise<string | null> {
    const match = (r: IamRole) => r.name === name && isSystemRole(r);
    const servedFromCache = this.catalogFresh();
    let hit: IamRole | undefined;
    let catalogError: unknown = null;
    try {
      hit = (await this.listSystemRoles(bearer)).find(match);
      if (!hit && servedFromCache) hit = (await this.listSystemRoles(bearer, { force: true })).find(match);
    } catch (err) {
      // Not fatal yet: the workspace's own list may still name it.
      if (!workspaceId) throw err;
      catalogError = err;
    }
    if (!hit && workspaceId) {
      hit = (await this.listRoles(bearer, workspaceId)).find(match);
    }
    // A catalog failure that the fallback did not paper over is the caller's
    // to map (a 403 is THEM refusing the caller, not "no such role").
    if (!hit && catalogError) throw catalogError;
    return hit?.id ?? null;
  }

  removeWorkspaceUser(bearer: string, workspaceUserId: string): Promise<unknown> {
    return this.call(bearer, 'DELETE', `/workspaceUser/member/${encodeURIComponent(workspaceUserId)}`);
  }

  setWorkspaceUserActive(bearer: string, workspaceUserId: string, active: boolean): Promise<unknown> {
    return this.call(bearer, 'PUT', '/workspaceUser', { id: workspaceUserId, is_active: active });
  }

  assignRole(bearer: string, workspaceUserId: string, roleId: string): Promise<unknown> {
    return this.call(bearer, 'POST', '/workspaceUser/assign-role', {
      workspace_user_id: workspaceUserId,
      role_id: roleId,
    });
  }

  // --- Invitations ---------------------------------------------------------

  createInvitation(
    bearer: string,
    input: { invited_email: string; workspace_id: string; role_id?: string; message?: string },
  ): Promise<IamInvitation> {
    return this.call<IamInvitation>(bearer, 'POST', '/workspace-invitations', {
      invited_email: input.invited_email,
      workspace_id: input.workspace_id,
      role: 'MEMBER',
      ...(input.role_id ? { role_id: input.role_id } : {}),
      message: input.message ?? '',
    });
  }

  resendInvitation(bearer: string, invitationId: string): Promise<unknown> {
    return this.call(bearer, 'POST', '/workspace-invitations/resend', { invitation_id: invitationId });
  }

  /** `status` is upstream's enum, UPPERCASE: PENDING | ACCEPTED | REJECTED | EXPIRED | CANCELLED. */
  async listInvitations(
    bearer: string,
    workspaceId: string,
    status = 'PENDING',
  ): Promise<IamInvitation[]> {
    const res = await this.call<{ data?: IamInvitation[] }>(
      bearer,
      'GET',
      `/workspace-invitations/${encodeURIComponent(workspaceId)}/paginated?page=1&limit=${PAGE_SIZE}&status=${encodeURIComponent(status.toUpperCase())}`,
    );
    return Array.isArray(res?.data) ? res.data : [];
  }

  // --- Transport -----------------------------------------------------------

  private async call<T = unknown>(bearer: string, method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${bearer}`,
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new IamUnavailableError(`IAM ${method} ${path} unreachable: ${String(err)}`);
    }
    if (res.status === 429 || res.status >= 500) {
      throw new IamUnavailableError(`IAM ${method} ${path} → HTTP ${res.status}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new IamHttpError(res.status, method, path, text.slice(0, 500));
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined as T;
    }
  }
}
