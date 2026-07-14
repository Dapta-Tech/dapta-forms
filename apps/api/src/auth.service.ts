import { Inject, Injectable } from '@nestjs/common';
import type { Db } from '@quill/db';
import { getMemberRole } from '@quill/db';
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
    const role = (await getMemberRole(this.db, id.accountId, id.memberId)) ?? 'member';
    return { ...id, role };
  }
}
