/**
 * Keeps the local workspace rows in step with the identity service, per person.
 *
 * `ensure()` is the whole contract: given a validated identity and its bearer,
 * make the local `account`/`member` rows agree with what the identity service
 * says about that person, at most once per TTL. Everything downstream — the
 * switcher, the header check, the role a route sees — keeps reading local
 * rows, so a request costs zero upstream calls once a session is warm.
 *
 * Failure policy: the identity service being down must not lock anyone out
 * who has been here before. A stale projection is served (with a warning);
 * only a first-ever login with nothing local behind it is refused, and it is
 * refused as 503, not 401 — the token was fine, we could not learn what it is
 * allowed to see.
 */
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Db } from '@quill/db';
import {
  getAccountByExternalId,
  humanHasCompletedOnboarding,
  pickHomeAccount,
  projectMemberships,
  rebindLegacyAccount,
  sql,
  type ProjectedMembership,
} from '@quill/db';
import {
  IamUnavailableError,
  IamWorkspacesClient,
  membershipOf,
  roleFromIam,
  type IamWorkspace,
} from './iam-workspaces';
import { maybeSeedDemoForm, notifySignup, type SeedDemoEnv, type SignupObserver } from './auth.provider';

/** What the auth provider proved about the caller — never read from the request body. */
export interface UpstreamIdentity {
  /** The token `sub` = the identity service's user id = `member.external_id`. */
  sub: string;
  /** The person's OWN upstream account (billing layer), from the token. */
  iamAccountId: string;
  email: string | null;
  displayName: string | null;
  /** The raw bearer, forwarded upstream as-is. */
  bearer: string;
}

export interface ProjectionState {
  /** Upstream workspace id the person opened last (anywhere), or null. */
  lastWorkspace: string | null;
  /** The person's own account `feature_flags`, as last read (for read-modify-write). */
  featureFlags: Record<string, unknown> | null;
  /** True when this state was served from cache past its TTL because upstream failed. */
  degraded: boolean;
  syncedAt: number;
}

const DEFAULT_TTL_MS = 60_000;

export class WorkspaceProjection {
  private readonly log = new Logger('WorkspaceProjection');
  private readonly cache = new Map<string, ProjectionState>();
  private readonly ttlMs: number;

  constructor(
    private readonly db: Db,
    /** Public so the workspace service can write upstream with the same client. */
    readonly iam: IamWorkspacesClient,
    private readonly opts: {
      ttlMs?: number;
      seedEnv?: SeedDemoEnv;
      onSignup?: SignupObserver;
      now?: () => number;
    } = {},
  ) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  /** Forget the cached state for one person (after a write that changed it). */
  invalidate(sub: string): void {
    this.cache.delete(sub);
  }

  /**
   * Refresh the projection for this person unless it was refreshed within the
   * TTL. `force` bypasses the TTL (after a create/invite/switch, and when the
   * switcher opens).
   */
  async ensure(id: UpstreamIdentity, opts: { force?: boolean } = {}): Promise<ProjectionState> {
    const cached = this.cache.get(id.sub);
    const now = this.now();
    if (cached && !opts.force && now - cached.syncedAt < this.ttlMs) return cached;

    let workspaces: IamWorkspace[];
    let featureFlags: Record<string, unknown> | null = null;
    try {
      const [account, wss] = await Promise.all([
        this.iam.getAccount(id.bearer, id.iamAccountId).catch((err) => {
          // The person's account row is nice-to-have (last_workspace); a
          // failure there must not fail the workspace list.
          if (err instanceof IamUnavailableError) throw err;
          this.log.warn(`IAM account read failed for ${id.iamAccountId}: ${String(err)}`);
          return null;
        }),
        this.iam.listMyWorkspaces(id.bearer, id.sub),
      ]);
      workspaces = wss;
      featureFlags =
        account?.feature_flags && typeof account.feature_flags === 'object' ? account.feature_flags : null;
    } catch (err) {
      if (!(err instanceof IamUnavailableError)) throw err;
      if (cached) {
        this.log.warn(`IAM unavailable; serving stale projection for ${id.sub}: ${err.message}`);
        return { ...cached, degraded: true };
      }
      const local = await pickHomeAccount(this.db, id.sub, null);
      if (local) {
        this.log.warn(`IAM unavailable; serving local rows for ${id.sub}: ${err.message}`);
        const state: ProjectionState = { lastWorkspace: null, featureFlags: null, degraded: true, syncedAt: now };
        // Do NOT cache a degraded state past this call: retry upstream next time.
        return state;
      }
      throw new ServiceUnavailableException({
        error: 'IDENTITY_UNAVAILABLE',
        message: 'The identity service is unavailable. Try again in a moment.',
      });
    }

    const lastWorkspace =
      typeof featureFlags?.last_workspace === 'string' ? (featureFlags.last_workspace as string) : null;

    await this.rebindLegacy(id, workspaces, lastWorkspace);

    const memberships: ProjectedMembership[] = workspaces.map((ws) => {
      const me = membershipOf(ws, id.sub);
      return {
        workspaceId: ws.id,
        workspaceName: ws.name,
        iamAccountId: ws.account_id ?? null,
        workspaceUserId: me?.id ?? null,
        role: me ? roleFromIam(me) : 'owner',
        active: me ? me.is_active !== false : true,
      };
    });

    const inheritOnboarding = await humanHasCompletedOnboarding(this.db, id.sub);
    const result = await projectMemberships(
      this.db,
      { externalId: id.sub, email: id.email, displayName: id.displayName },
      memberships,
      { inheritOnboarding, now },
    );

    for (const c of result.created) {
      if (c.role === 'owner' && result.createdAccounts.includes(c.accountId) && this.opts.seedEnv) {
        await maybeSeedDemoForm(this.db, c.accountId, this.opts.seedEnv, this.log);
      }
      notifySignup(this.opts.onSignup, this.log, {
        accountId: c.accountId,
        memberId: c.memberId,
        email: id.email,
        role: c.role,
        isFirstMember: c.isFirstMember,
        fromInvite: false,
      });
    }

    const state: ProjectionState = { lastWorkspace, featureFlags, degraded: false, syncedAt: now };
    this.cache.set(id.sub, state);
    return state;
  }

  /**
   * Where this person lands: the workspace they opened last (in either app),
   * if they are still a member of it; else their most recently seen local
   * membership; else null (nothing upstream, nothing local).
   */
  async home(id: UpstreamIdentity, state: ProjectionState): Promise<{ accountId: string; memberId: string } | null> {
    return pickHomeAccount(this.db, id.sub, state.lastWorkspace);
  }

  /**
   * Record that this person opened a workspace — upstream, so the Dapta app
   * opens the same one next. Best-effort: a failure here is logged and costs
   * the switch nothing.
   */
  async rememberLastWorkspace(id: UpstreamIdentity, accountId: string): Promise<void> {
    const row = await this.db.get<{ external_id: string | null }>(
      sql`SELECT external_id FROM account WHERE id = ${accountId} LIMIT 1`,
    );
    const workspaceId = row?.external_id ?? null;
    if (!workspaceId || workspaceId.startsWith('local:') || workspaceId.startsWith('dev:')) return;
    const cached = this.cache.get(id.sub);
    if (cached?.lastWorkspace === workspaceId) return;
    try {
      await this.iam.setLastWorkspace(id.bearer, id.iamAccountId, workspaceId, cached?.featureFlags ?? null);
      if (cached) {
        cached.lastWorkspace = workspaceId;
        cached.featureFlags = { ...(cached.featureFlags ?? {}), last_workspace: workspaceId };
      }
    } catch (err) {
      this.log.warn(`last_workspace write failed for ${id.sub}: ${String(err)}`);
    }
  }

  /**
   * Pre-0015 rows: `account.external_id` held the person's upstream ACCOUNT id.
   * Bind that row to the upstream workspace it should mean — the last one they
   * opened if it belongs to that account, else the first of that account's.
   */
  private async rebindLegacy(id: UpstreamIdentity, workspaces: IamWorkspace[], lastWorkspace: string | null) {
    const legacy = await getAccountByExternalId(this.db, id.iamAccountId);
    if (!legacy) return;
    // Only workspaces that hang from the person's own account can absorb their
    // legacy row; a workspace someone else owns is not where their forms live.
    const own = workspaces.filter((w) => w.account_id === id.iamAccountId);
    if (own.length === 0) {
      this.log.warn(`legacy account ${legacy.id} for ${id.iamAccountId}: no upstream workspace of that account is visible; left as is`);
      return;
    }
    const target = own.find((w) => w.id === lastWorkspace) ?? own[0]!;
    const res = await rebindLegacyAccount(this.db, {
      iamAccountId: id.iamAccountId,
      workspaceId: target.id,
      workspaceName: target.name,
    });
    if (res?.parkedLegacyId) {
      this.log.error(
        `legacy account ${res.parkedLegacyId} could not absorb workspace ${target.id} (projected account ${res.accountId} already has forms); parked`,
      );
    } else if (res) {
      this.log.log(`legacy account ${res.accountId} rebound to upstream workspace ${target.id}`);
    }
  }
}
