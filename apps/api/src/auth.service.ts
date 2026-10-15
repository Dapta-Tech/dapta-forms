import { ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import type { Db } from '@quill/db';
import {
  activateInvitedMember,
  findMembership,
  getMemberIdentity,
  getMemberRole,
  listWorkspacesForIdentity,
  touchMemberLastSeen,
  type WorkspaceRow,
} from '@quill/db';
import { AnalyticsEffects } from './analytics-effects';
import { apiKeyFromRequest } from './api-keys';
import { ApiKeyAuthenticator, createApiKeyRateLimiter } from './api-key-auth';
import type { RateLimiter } from './rate-limit';
import { API_KEY_RATE_LIMITER, AUTH_PROVIDER, DB } from './tokens';
import { header, type AuthProvider, type HostPrincipal, type ReqLike } from './auth.provider';

export type { HostPrincipal, PrincipalVia, ReqLike } from './auth.provider';
export { isApiKeyPrincipal } from './auth.provider';

/** The header the web app uses to ask for a workspace other than the home one. */
export const WORKSPACE_HEADER = 'x-quill-workspace';

/**
 * Auth authority for the API. Host/dashboard identity is delegated to the
 * pluggable `AuthProvider` port (local dev stub / WorkOS overlay) selected on
 * `AUTH_PROVIDER`.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AUTH_PROVIDER) private readonly provider: AuthProvider,
    // Optional so existing direct constructions (tests) keep working. Only its
    // `enabled` flag is read here — auth never emits an event itself.
    @Optional() @Inject(AnalyticsEffects) private readonly productAnalytics?: AnalyticsEffects,
    // The per-key limiter (120 a minute). Optional for the same reason; absent,
    // each AuthService gets its own in-memory one.
    @Optional() @Inject(API_KEY_RATE_LIMITER) keyLimiter?: RateLimiter,
  ) {
    this.apiKeys = new ApiKeyAuthenticator(db, keyLimiter ?? createApiKeyRateLimiter());
  }

  private readonly apiKeys: ApiKeyAuthenticator;

  /**
   * Resolve the authenticated host, and then the account they are acting in.
   *
   * Those are two different questions, and separating them is the point of this
   * method. The provider answers only the first — WHO is calling — from a token
   * it validated. WHICH account they act in used to be the same answer: the
   * token's `account_id`, or for the dev stub the caller's oldest member row.
   * That made a second workspace unreachable and made every invitation a dead
   * end, because signing in always landed you back in your own account.
   *
   * A request may now NAME an account via `x-quill-workspace`, and that name is
   * treated as nothing more than a request. Authorization comes from
   * re-deriving membership out of the database, on every request, keyed to the
   * identity the provider already proved. A header naming an account the caller
   * has no row in is a 403 — never a quiet fall back to the home account,
   * because a quiet fallback means writes land in a tenant the person did not
   * believe they were in.
   *
   * A request with `Authorization: Bearer dforms_...` is an API key and never
   * reaches the provider: `ApiKeyAuthenticator` resolves it to the key's member
   * and workspace, with `via: 'api_key'` and `apiKeyId` (401 for a dead key,
   * 403 for another workspace, 429 past the per-key limit). Every other
   * principal came in through the provider's session, so it carries
   * `via: 'session'` and no `apiKeyId`.
   *
   * Throws 401 if the provider cannot resolve the host.
   */
  async resolveHost(req: ReqLike): Promise<HostPrincipal> {
    const key = apiKeyFromRequest(req);
    if (key !== null) return this.apiKeys.resolve(req, key);

    const home = await this.provider.resolveHost(req);
    // An invited member who actually shows up is no longer invited. Nothing
    // flipped this before, so someone who accepted stayed "invited" in the
    // members list forever and an admin had no way to tell a pending invite
    // from an active teammate. Scoped to exactly that transition — `disabled`
    // must never be revived by a login, which is the whole point of disabling.
    await activateInvitedMember(this.db, home.accountId, home.memberId);

    // Liveness. Stamped on the HOME member (the person), not the workspace they
    // happen to be viewing — "did this human come back" is a property of the
    // human. Throttled inside the UPDATE, so an active session writes a handful
    // of times an hour instead of once per API call.
    //
    // Gated AND not awaited: this is analytics data, and a deployment that
    // collects none must not pay a round trip on every authenticated request —
    // the busiest path in the API. Awaiting it would serialize a write into
    // auth; `void` keeps it off the critical path, and the internal catch means
    // a failure can never surface as a rejected login.
    if (this.productAnalytics?.enabled) {
      void touchMemberLastSeen(this.db, home.memberId).catch(() => {});
    }

    const requested = header(req, WORKSPACE_HEADER)?.trim();
    if (!requested || requested === home.accountId) {
      const role = (await getMemberRole(this.db, home.accountId, home.memberId)) ?? 'member';
      return { ...home, role, via: 'session' };
    }

    const identity = await getMemberIdentity(this.db, home.accountId, home.memberId);
    const membership = identity ? await findMembership(this.db, identity, requested) : null;
    if (!membership) {
      throw new ForbiddenException({
        error: 'WORKSPACE_FORBIDDEN',
        message: 'You are not a member of that workspace.',
      });
    }

    // Opening a workspace you were invited to IS accepting the invitation — the
    // same transition the home account gets above, for the same reason.
    await activateInvitedMember(this.db, membership.accountId, membership.memberId);
    return {
      accountId: membership.accountId,
      memberId: membership.memberId,
      role: membership.role,
      via: 'session',
    };
  }

  /**
   * Every workspace the CALLER can enter.
   *
   * Derived from the home identity the provider resolved, never from whichever
   * workspace they are currently viewing — so the list reads the same from
   * inside any of them, and a switch can never strand someone somewhere with no
   * way back.
   */
  async listWorkspaces(req: ReqLike): Promise<WorkspaceRow[]> {
    const home = await this.provider.resolveHost(req);
    const identity = await getMemberIdentity(this.db, home.accountId, home.memberId);
    if (!identity) return [];
    return listWorkspacesForIdentity(this.db, identity);
  }
}
