/**
 * The identity service's workspace API, as this product consumes it.
 *
 * Every call forwards the CALLER's bearer token — the same platform JWT the
 * auth provider validated — so the identity service applies its own
 * authorization and this client never holds a privileged credential. Nothing
 * here is cached or persisted; `workspace-projection.ts` decides what to keep.
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

/** The upstream system role that maps to this product's `admin`. */
export const IAM_ADMIN_ROLE_NAME = 'workspace_admin';

/**
 * Upstream membership → local account role.
 *
 *   OWNER                              → owner
 *   MEMBER holding `workspace_admin`   → admin   (can manage members, branding, integrations)
 *   MEMBER with any other / no role    → member  (creates and edits forms, reads results)
 *
 * One function on purpose: when the identity service grows a `forms` component
 * in its permission catalog, this is the only place that changes.
 */
export function roleFromIam(wu: Pick<IamWorkspaceUser, 'type' | 'roles'>): AccountRole {
  if (wu.type === 'OWNER') return 'owner';
  const admin = (wu.roles ?? []).some((r) => (r.name ?? r.role?.name) === IAM_ADMIN_ROLE_NAME);
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

export interface IamWorkspacesClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class IamWorkspacesClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: IamWorkspacesClientOptions) {
    this.base = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? IAM_TIMEOUT_MS;
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

  async listRoles(bearer: string, workspaceId: string): Promise<IamRole[]> {
    const res = await this.call<IamRole[] | { data?: IamRole[] }>(
      bearer,
      'GET',
      `/role/roles-workspace/${encodeURIComponent(workspaceId)}`,
    );
    return Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
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
