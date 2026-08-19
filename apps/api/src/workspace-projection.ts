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
  listWorkspacesForIdentity,
  pickHomeAccount,
  projectMemberships,
  rebindLegacyAccount,
  sql,
  type ProjectedMembership,
} from '@quill/db';
import {
  IamHttpError,
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
/** How many already-projected memberships a staff refresh re-reads upstream (in parallel). */
const STAFF_KNOWN_LIMIT = 25;

export class WorkspaceProjection {
  private readonly log = new Logger('WorkspaceProjection');
  private readonly cache = new Map<string, ProjectionState>();
  /** One upstream read per person at a time: a cold session fires several API calls at once. */
  private readonly inflight = new Map<string, Promise<ProjectionState>>();
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
      /**
       * Email domains (lowercase, no `@`) whose people are STAFF of the
       * deployment: they may search the whole estate and enter any workspace
       * (see `WorkspaceService.enterEstateWorkspace`). Empty = nobody.
       */
      staffDomains?: readonly string[];
    } = {},
  ) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  }

  /** Whether this email belongs to the deployment's staff (by domain). */
  isStaff(email: string | null | undefined): boolean {
    const domains = this.opts.staffDomains ?? [];
    if (!domains.length || !email) return false;
    const at = email.lastIndexOf('@');
    if (at < 0) return false;
    const domain = email.slice(at + 1).trim().toLowerCase();
    return domains.includes(domain);
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
    const pending = this.inflight.get(id.sub);
    if (pending && !opts.force) return pending;
    const run = this.refresh(id, cached, now).finally(() => {
      if (this.inflight.get(id.sub) === run) this.inflight.delete(id.sub);
    });
    this.inflight.set(id.sub, run);
    return run;
  }

  private async refresh(
    id: UpstreamIdentity,
    cached: ProjectionState | undefined,
    now: number,
  ): Promise<ProjectionState> {
    let workspaces: IamWorkspace[];
    // Whether a membership the upstream stopped naming may be disabled below.
    // False only when the staff path could not re-read one of the person's
    // known workspaces: then "not in the list" proves nothing.
    let pruneMissing = true;
    let featureFlags: Record<string, unknown> | null = null;
    try {
      const [account, mine] = await Promise.all([
        this.iam.getAccount(id.bearer, id.iamAccountId).catch((err) => {
          // The person's account row is nice-to-have (last_workspace); a
          // failure there must not fail the workspace list.
          if (err instanceof IamUnavailableError) throw err;
          this.log.warn(`IAM account read failed for ${id.iamAccountId}: ${String(err)}`);
          return null;
        }),
        this.isStaff(id.email)
          ? this.staffMemberships(id)
          : this.iam.listMyWorkspaces(id.bearer, id.sub).then((wss) => ({ workspaces: wss, complete: true })),
      ]);
      workspaces = mine.workspaces;
      pruneMissing = mine.complete;
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
      { inheritOnboarding, now, pruneMissing },
    );

    for (const c of result.created) {
      // An access grant is not a person joining: no demo form, no signup event.
      if (c.accessGrant) continue;
      // "First member" counts REAL memberships: an account a staff grant
      // created ahead of its owner still gets the owner's demo form.
      if (c.role === 'owner' && c.isFirstMember && this.opts.seedEnv) {
        // No demo form in a workspace whose upstream ACCOUNT still has a
        // pre-0015 local row: that row holds the owner's real forms and must be
        // able to absorb this account on the owner's next login (see
        // rebindLegacyAccount) — a seeded form here would block the absorb.
        const row = await this.db.get<{ external_id: string | null }>(
          sql`SELECT external_id FROM account WHERE id = ${c.accountId} LIMIT 1`,
        );
        const ws = workspaces.find((w) => w.id === row?.external_id);
        const legacyBlocked = ws?.account_id ? !!(await getAccountByExternalId(this.db, ws.account_id)) : false;
        if (!legacyBlocked) await maybeSeedDemoForm(this.db, c.accountId, this.opts.seedEnv, this.log);
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
   * Project ONE upstream workspace the person is a real member of, without
   * touching any other row (no pruning). Used when staff enter an estate
   * workspace that turns out to name them: their refresh no longer reads the
   * estate (see `staffMemberships`), so a membership in someone else's account
   * that was never projected is found exactly here, and from then on it is a
   * known row the refresh re-reads.
   */
  async projectOne(id: UpstreamIdentity, ws: IamWorkspace): Promise<void> {
    const me = membershipOf(ws, id.sub);
    const inheritOnboarding = await humanHasCompletedOnboarding(this.db, id.sub);
    await projectMemberships(
      this.db,
      { externalId: id.sub, email: id.email, displayName: id.displayName },
      [
        {
          workspaceId: ws.id,
          workspaceName: ws.name,
          iamAccountId: ws.account_id ?? null,
          workspaceUserId: me?.id ?? null,
          role: me ? roleFromIam(me) : 'owner',
          active: me ? me.is_active !== false : true,
        },
      ],
      { inheritOnboarding, now: this.now(), pruneMissing: false },
    );
    this.invalidate(id.sub);
  }

  /**
   * The memberships of one of the deployment's STAFF, without reading the
   * estate. To a staff token the unscoped upstream search answers with every
   * workspace there is, and paging through all of it on every refresh (every
   * TTL, every switcher open) is what made each staff request take tens of
   * seconds. Instead:
   *
   *   1. the workspaces of the person's OWN upstream account (the search,
   *      scoped with `accountId`: a page or two), and
   *   2. every other workspace this database already knows them in (a
   *      membership projected earlier, or a staff grant), re-read one by one,
   *      in parallel, so a membership revoked upstream is still disabled and
   *      a grant whose workspace now names them becomes the real membership.
   *
   * What this cannot see: a membership in someone ELSE's account that was never
   * projected here. Staff reach those through the estate search, and entering
   * one re-reads it upstream and projects the real membership when there is
   * one (`enterEstateWorkspace`), so it joins the list from then on.
   *
   * `complete` is false when one of the re-reads failed for a reason other than
   * "gone" (404): the caller then skips pruning, because a workspace absent
   * from this list might simply not have answered.
   */
  private async staffMemberships(id: UpstreamIdentity): Promise<{ workspaces: IamWorkspace[]; complete: boolean }> {
    const own = await this.iam.listAccountWorkspaces(id.bearer, id.sub, id.iamAccountId);
    const seen = new Set(own.map((w) => w.id));
    const known = (await listWorkspacesForIdentity(this.db, { externalId: id.sub, email: id.email }))
      .filter((r) => !!r.workspaceId && !seen.has(r.workspaceId as string))
      // A pre-0015 row carries the upstream ACCOUNT id, not a workspace; the
      // legacy rebind below handles it, a workspace read would only 404.
      .filter((r) => r.workspaceId !== id.iamAccountId)
      .map((r) => r.workspaceId as string);
    if (known.length > STAFF_KNOWN_LIMIT) {
      this.log.warn(`staff ${id.sub} holds ${known.length} projected memberships; re-reading the first ${STAFF_KNOWN_LIMIT}`);
    }
    const reads = await Promise.all(
      known.slice(0, STAFF_KNOWN_LIMIT).map((wsId) =>
        this.iam.getWorkspace(id.bearer, wsId).then(
          (ws): { ws: IamWorkspace | null; failed: boolean } => ({ ws, failed: false }),
          (err: unknown) => {
            if (err instanceof IamUnavailableError) throw err;
            // Gone upstream: a real "not yours any more", prune applies.
            if (err instanceof IamHttpError && err.status === 404) return { ws: null, failed: false };
            this.log.warn(`staff workspace re-read failed for ${wsId}: ${String(err)}`);
            return { ws: null, failed: true };
          },
        ),
      ),
    );
    let complete = known.length <= STAFF_KNOWN_LIMIT;
    for (const r of reads) {
      if (r.failed) complete = false;
      const ws = r.ws;
      if (!ws || typeof ws.id !== 'string' || seen.has(ws.id)) continue;
      seen.add(ws.id);
      if (ws.is_active === false) continue;
      const me = membershipOf(ws, id.sub);
      if (me || ws.isOwner === true) own.push(ws);
    }
    return { workspaces: own, complete };
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
