import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Db } from '@quill/db';
import { cacheEntitlement, getMe, setVanitySlug, sql, type VanityOutcome } from '@quill/db';
import { canClaimVanitySlug } from '@quill/engine';
import type { HostPrincipal } from './auth.service';
import { DisabledEntitlementsProvider, type EntitlementsProvider } from './entitlements.provider';
import { DB, ENTITLEMENTS, PREMIUM_MODE } from './tokens';

/** How long a cached Dapta AI entitlement verdict stays fresh before re-asking upstream. */
const ENTITLEMENT_TTL_MS = 6 * 3600_000;

/** Authed host/dashboard operations. All are scoped to the caller's account. */
@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    // Optional so existing direct constructions keep working: OSS default is
    // no upstream + `open` premium mode (fork-friendly).
    @Optional()
    @Inject(ENTITLEMENTS)
    private readonly entitlements: EntitlementsProvider = new DisabledEntitlementsProvider(),
    @Optional() @Inject(PREMIUM_MODE) private readonly premiumMode: 'open' | 'locked' = 'open',
  ) {}

  me(p: HostPrincipal) {
    return getMe(this.db, p.accountId, p.memberId);
  }

  // --- Vanity slug (premium — included with the Dapta AI subscription) ------

  /**
   * Is this account entitled to premium features? Forms is ALWAYS free — the
   * unlock is the customer's Dapta AI subscription, validated upstream and CACHED
   * on the account row (TTL). `PREMIUM_FEATURES=open` (the OSS default) short-
   * circuits so a bare fork gets everything.
   */
  private async isEntitled(accountId: string): Promise<boolean> {
    if (this.premiumMode === 'open') return true;
    const acc = await this.db.get<{
      external_id: string | null;
      dapta_entitlement: string | null;
      entitlement_checked_at: number | null;
    }>(
      sql`SELECT external_id, dapta_entitlement, entitlement_checked_at
          FROM account WHERE id = ${accountId} LIMIT 1`,
    );
    if (!acc) return false;
    const checked = acc.entitlement_checked_at ? Number(acc.entitlement_checked_at) : 0;
    if (checked && Date.now() - checked < ENTITLEMENT_TTL_MS) {
      return acc.dapta_entitlement === 'paid';
    }
    if (!this.entitlements.enabled) return acc.dapta_entitlement === 'paid';
    const owner = await this.db.get<{ email: string | null }>(
      sql`SELECT email FROM member
          WHERE account_id = ${accountId} AND role = 'owner' AND status = 'active'
          ORDER BY created_at ASC LIMIT 1`,
    );
    const paid = await this.entitlements.isPaidCustomer({
      ownerEmail: owner?.email,
      externalOrgId: acc.external_id,
    });
    await cacheEntitlement(this.db, accountId, paid ? 'paid' : 'free');
    return paid;
  }

  /** The Settings surface's view of the vanity feature. */
  async vanityStatus(
    p: HostPrincipal,
  ): Promise<{ vanitySlug: string | null; shortCode: string; canClaim: boolean }> {
    const me = await getMe(this.db, p.accountId, p.memberId);
    const entitled = await this.isEntitled(p.accountId);
    return {
      vanitySlug: me?.vanitySlug ?? null,
      shortCode: me?.accountShortCode ?? '',
      canClaim: canClaimVanitySlug(this.premiumMode, entitled),
    };
  }

  /** Claim / change / clear (null) the vanity slug. Caller enforces admin role. */
  async setVanity(
    p: HostPrincipal,
    slug: string | null,
  ): Promise<VanityOutcome | { ok: false; reason: 'NOT_ENTITLED' }> {
    const entitled = await this.isEntitled(p.accountId);
    if (!canClaimVanitySlug(this.premiumMode, entitled)) return { ok: false, reason: 'NOT_ENTITLED' };
    return setVanitySlug(this.db, p.accountId, slug);
  }
}
