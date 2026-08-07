import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Db } from '@quill/db';
import {
  cacheEntitlement,
  claimOnboardingComplete,
  createForm,
  getFormTemplate,
  getMe,
  saveOnboardingProgress,
  setVanitySlug,
  sql,
  type VanityOutcome,
} from '@quill/db';
import { canClaimVanitySlug } from '@quill/engine';
import type { FormTemplateId, OnboardingProgressInput } from '@quill/types';
import type { HostPrincipal } from './auth.service';
import { DisabledEntitlementsProvider, type EntitlementsProvider } from './entitlements.provider';
import { DB, ENTITLEMENTS, ONBOARDING_ENABLED, PREMIUM_MODE } from './tokens';

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
    // Whether the first-run wizard is switched on for this deployment. Optional
    // + default false so every direct construction (tests, forks) behaves as it
    // did before the feature existed.
    @Optional() @Inject(ONBOARDING_ENABLED) private readonly onboardingEnabled: boolean = false,
  ) {}

  /**
   * The caller's identity, plus `onboardingRequired`.
   *
   * That flag is computed HERE, not in the web app, and that is the point: the
   * dashboard must not carry its own copy of the feature switch. If it did, an
   * environment with the flag on in the web and off in the API would bounce
   * every user into a wizard whose endpoints refuse to serve it — a login loop
   * with no way out. One authority, one answer.
   */
  async me(p: HostPrincipal) {
    const view = await getMe(this.db, p.accountId, p.memberId);
    if (!view) return view;
    return {
      ...view,
      onboardingRequired: this.onboardingEnabled && view.onboardingCompletedAt == null,
    };
  }

  // --- Onboarding (first-run wizard) ---------------------------------------

  /**
   * Record one screen's worth of progress.
   *
   * Returns null when the wizard is off, the account is gone, or its onboarding
   * is already complete — every one of which the caller reports the same way,
   * because none of them is an error the person can act on. A stale tab patching
   * a finished onboarding is normal, not a fault.
   */
  async saveOnboarding(p: HostPrincipal, patch: OnboardingProgressInput) {
    if (!this.onboardingEnabled) return null;
    return saveOnboardingProgress(this.db, p.accountId, patch);
  }

  /**
   * Finish the wizard: claim completion and create the account's first form from
   * the chosen template.
   *
   * Order matters and is not interchangeable. The CLAIM runs first, and only its
   * winner creates a form. Creating first would mean a double-submit produced two
   * "first" forms — the exact mess the demo-form seed's idempotence was written
   * to avoid, reintroduced on the one screen every new user passes through.
   *
   * The template id is resolved to a config HERE, from a server-side registry, so
   * the request body can only ever name a starting point — never supply one.
   */
  async completeOnboarding(
    p: HostPrincipal,
    templateId: FormTemplateId,
  ): Promise<{ completed: boolean; formId: string | null }> {
    if (!this.onboardingEnabled) return { completed: false, formId: null };

    const template = getFormTemplate(templateId);
    if (!template) return { completed: false, formId: null };

    const won = await claimOnboardingComplete(this.db, p.accountId, templateId);
    if (!won) {
      // A loser must not create a second form. It still needs somewhere to send
      // the person, so hand back the form the WINNER made (the account's first).
      const existing = await this.db.get<{ id: string }>(
        sql`SELECT id FROM form WHERE account_id = ${p.accountId}
            ORDER BY created_at ASC LIMIT 1`,
      );
      return { completed: false, formId: existing?.id ?? null };
    }

    const created = await createForm(
      this.db,
      p.accountId,
      { name: template.name, ...(template.config ? { config: template.config } : {}) },
      p.memberId,
    );
    // A failed create must NOT un-claim the completion: the person answered the
    // questions and those answers are stored. Sending them back through the
    // wizard to re-answer would lose the thing we actually wanted. They land on
    // an empty dashboard instead, where "New form" is the obvious next click.
    return { completed: true, formId: created.ok ? created.value.id : null };
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
