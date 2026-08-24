import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Db } from '@quill/db';
import {
  cacheEntitlement,
  claimOnboardingComplete,
  createForm,
  getAccountOnboarding,
  getFormTemplate,
  getMe,
  getMemberIdentity,
  humanHasCompletedOnboarding,
  recordOnboardingFormId,
  saveOnboardingProgress,
  setVanitySlug,
  sql,
  type VanityOutcome,
} from '@quill/db';
import { canClaimVanitySlug } from '@quill/engine';
import { getMessages } from '@quill/shared';
import type {
  AccountOnboarding,
  FormTemplateId,
  OnboardingCompleteInput,
  OnboardingProgressInput,
} from '@quill/types';
import type { HostPrincipal } from './auth.service';
import { isAdmin } from './permissions';
import { DisabledEntitlementsProvider, type EntitlementsProvider } from './entitlements.provider';
import { DaptaSyncEffects } from './dapta-sync-effects';
import { DB, ENTITLEMENTS, ONBOARDING_ENABLED, PREMIUM_MODE } from './tokens';

/** How long a cached Dapta AI entitlement verdict stays fresh before re-asking upstream. */
const ENTITLEMENT_TTL_MS = 6 * 3600_000;

/**
 * The wizard's answer fields, for the early-sync trigger. `role` is absent on
 * purpose — it is no longer asked, and counting a legacy blob's role would
 * stop the first NEW answer from reading as first.
 */
const ANSWER_FIELDS = [
  'phone',
  'industry',
  'crm',
  'leadVolume',
  'leadSource',
  'useCase',
] as const satisfies ReadonlyArray<keyof AccountOnboarding>;

/** How many wizard questions this blob has a stored answer for. */
function answerCount(blob: AccountOnboarding): number {
  return ANSWER_FIELDS.reduce((n, field) => (blob[field] != null ? n + 1 : n), 0);
}

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
    // Explicit class token (esbuild elides type-only imports); optional so a
    // deployment without the Dapta pipeline — every fork — simply has no sync.
    @Optional() @Inject(DaptaSyncEffects) private readonly daptaSync?: DaptaSyncEffects,
  ) {}

  /**
   * The caller's identity, plus `onboardingRequired`.
   *
   * That flag is computed HERE, not in the web app, and that is the point: the
   * dashboard must not carry its own copy of the feature switch. If it did, an
   * environment with the flag on in the web and off in the API would bounce
   * every user into a wizard whose endpoints refuse to serve it — a login loop
   * with no way out. One authority, one answer.
   *
   * ROLE is part of that answer, and leaving it out was a lockout. The wizard
   * describes the WORKSPACE, so both its endpoints are admin-gated; an
   * account-scoped flag would therefore send a plain `member` — a colleague who
   * joined an org whose owner abandoned the wizard — to a screen where every
   * write 403s, the completion 403s, and the fallback lands back under the gate
   * that sent them. No sidebar, no sign-out, no way out. Answering `false` for
   * anyone who cannot complete it puts them on the dashboard of a workspace
   * whose owner has not finished setting up, which is a normal state.
   *
   * And it is asked of a PERSON once, not of every workspace they are later in.
   * The stamp lives on the account (it is also what the wizard's endpoints
   * guard on), but the gate reads the person's history: someone who was ever
   * in a stamped workspace (the same test `inheritOnboarding` uses at
   * projection time) is not sent through the wizard again when the identity
   * service projects them, as owner, into another one whose local row predates
   * them (created by a colleague's access grant, say). Deliberately that wide:
   * "was around when a workspace was set up", not "personally answered" — the
   * projection inherits the stamp onto accounts it CREATES on the same
   * criterion; this covers the ones it did not.
   */
  async me(p: HostPrincipal) {
    const view = await getMe(this.db, p.accountId, p.memberId);
    if (!view) return view;
    let required =
      this.onboardingEnabled && view.onboardingCompletedAt == null && isAdmin(p.role) && !view.accessGrant;
    // Never for an access grant: the wizard describes the workspace and is
    // its owner's to answer, not the staff member's who dropped in.
    if (required) {
      const identity = await getMemberIdentity(this.db, p.accountId, p.memberId);
      if (identity?.externalId && (await humanHasCompletedOnboarding(this.db, identity.externalId))) {
        required = false;
      }
    }
    return { ...view, onboardingRequired: required };
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
    const merged = await saveOnboardingProgress(this.db, p.accountId, patch);
    // The FIRST answer just landed → make the person exist in the CRM now,
    // not only if they finish. Exactly-one on the MERGED blob: deterministic
    // without knowing the cohort (the PATCH does not carry it), no extra
    // query, and a repeat — a refresh re-sending the same answer — at worst
    // re-enqueues a call that upserts by email anyway. Awaited, not voided:
    // the enqueue is a LOCAL outbox insert that never rejects, so this costs
    // one write — the network delivery stays in the worker (invariant 5).
    if (merged && answerCount(merged) === 1) {
      await this.daptaSync?.enqueueEarly(p.accountId, p.memberId);
    }
    return merged;
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
   *
   * The NAME comes from the same i18n catalog the wizard rendered its cards
   * from, so the form is called what the card said. The registry's own `name` is
   * the fallback for a caller that names no locale — it is English, and having
   * two places that both answer "what is this template called" is how a Spanish
   * signup ended up clicking "Calificador de leads" and getting "Lead qualifier".
   */
  async completeOnboarding(
    p: HostPrincipal,
    input: OnboardingCompleteInput,
  ): Promise<{ completed: boolean; formId: string | null }> {
    if (!this.onboardingEnabled) return { completed: false, formId: null };

    const templateId = input.template;
    const template = getFormTemplate(templateId);
    if (!template) return { completed: false, formId: null };

    const won = await claimOnboardingComplete(
      this.db,
      p.accountId,
      templateId,
      {
        role: input.role,
        industry: input.industry,
        useCase: input.useCase,
        crm: input.crm,
        leadVolume: input.leadVolume,
        leadSource: input.leadSource,
        phone: input.phone,
      },
      // The cohort comes from the WIZARD, which is where the IAM probe runs —
      // the API has no `IAM_BASE_URL` and giving it one would mean a configmap
      // owned by another team, for a lookup the web already made.
      input.cohort,
    );
    if (!won) {
      // A loser must not create a second form. It still needs somewhere to send
      // the person, so hand back the form the WINNER made — read from the blob
      // the winner recorded it in, never guessed from the account's oldest form.
      // On an account that already had one (a re-gated workspace, a fork that
      // toggled the flag) the oldest form is an unrelated one, and the loser
      // would land in it with the first-run tour armed.
      const state = await getAccountOnboarding(this.db, p.accountId);
      return { completed: false, formId: state?.onboarding?.formId ?? null };
    }

    // The claim is won — the answers are stored — so the estate sync fires
    // HERE, not after form creation: a failed create keeps the completion
    // (see below), and it must keep the sync too. Awaited for the same reason
    // as the early hook: a local never-rejecting insert, not a network call.
    await this.daptaSync?.enqueueComplete(p.accountId, p.memberId);

    // Not guarded by `hasExtraHubspotDestination`, unlike POST /v1/forms: the
    // config here is a static server-authored template from the registry, never
    // caller input, and no template declares `destinations` at all. If one ever
    // does, this is the third authoring path and it needs the same check.
    const created = await createForm(
      this.db,
      p.accountId,
      {
        name: this.templateFormName(templateId, template.name, input.locale),
        ...(template.config ? { config: template.config } : {}),
      },
      p.memberId,
    );
    // A failed create must NOT un-claim the completion: the person answered the
    // questions and those answers are stored. Sending them back through the
    // wizard to re-answer would lose the thing we actually wanted. They land on
    // an empty dashboard instead, where "New form" is the obvious next click.
    if (!created.ok) return { completed: true, formId: null };

    await recordOnboardingFormId(this.db, p.accountId, created.value.id);
    return { completed: true, formId: created.value.id };
  }

  /** The created form's name in the locale the wizard rendered its cards in. */
  private templateFormName(id: FormTemplateId, fallback: string, locale?: 'en' | 'es'): string {
    if (!locale) return fallback;
    return getMessages(locale).admin.onboarding.templates.options[id].formName;
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
