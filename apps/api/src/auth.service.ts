import { Inject, Injectable } from '@nestjs/common';
import type { Db } from '@quill/db';
import { activateInvitedMember, getMemberRole } from '@quill/db';
import { AUTH_PROVIDER, DB } from './tokens';
import { type AuthProvider, type HostPrincipal, type ReqLike } from './auth.provider';

export type { HostPrincipal, ReqLike } from './auth.provider';

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
  ) {}

  /**
   * Resolve the authenticated host via the configured provider, then enrich it
   * with the account role (`member.role`) so the permission layer can authorize.
   * The provider stays role-agnostic; role resolution is centralized here so it
   * behaves identically across the local and workos providers. Throws 401 if the
   * provider cannot resolve the host.
   */
  async resolveHost(req: ReqLike): Promise<HostPrincipal> {
    const id = await this.provider.resolveHost(req);
    // An invited member who actually shows up is no longer invited. Nothing
    // flipped this before, so someone who accepted stayed "invited" in the
    // members list forever and an admin had no way to tell a pending invite
    // from an active teammate. Scoped to exactly that transition — `disabled`
    // must never be revived by a login, which is the whole point of disabling.
    await activateInvitedMember(this.db, id.accountId, id.memberId);
    const role = (await getMemberRole(this.db, id.accountId, id.memberId)) ?? 'member';
    return { ...id, role };
  }
}
