import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ServerEnv } from '@quill/config/env';
import {
  countReferrals,
  creditReferral,
  ensureReferrer,
  getMe,
  getReferrerByCode,
  referralPersonKey,
  type Db,
  type ReferralSource,
} from '@quill/db';
import { REFERRAL_GOAL, buildReferralLink, referralLinkBase } from '@quill/shared';
import { AnalyticsEffects } from './analytics-effects';
import { DB, REFERRAL_OPTIONS } from './tokens';

/** The referral program's switch and where its links point, resolved once from env. */
export interface ReferralOptions {
  /** `REFERRAL_PROGRAM`, and a base to link to. Off by default. */
  enabled: boolean;
  /** The landing, else the app (`referralLinkBase`). Null only when off. */
  baseUrl: string | null;
  /** Code generator. Injectable so a collision is testable. */
  code?: () => string;
  /** The clock. */
  now?: () => number;
}

/**
 * Resolve the switch ONCE, the way `ONBOARDING_WIZARD` is: the web app reads
 * the answer off `/v1/me.referral` and never keeps its own copy. With no URL
 * to link to, the program stays off rather than handing out a dead link.
 */
export function referralOptions(
  env: Pick<ServerEnv, 'REFERRAL_PROGRAM' | 'PUBLIC_APP_URL'> & Partial<Pick<ServerEnv, 'NEXT_PUBLIC_LANDING_URL'>>,
): ReferralOptions {
  const baseUrl = referralLinkBase({ landingUrl: env.NEXT_PUBLIC_LANDING_URL, appUrl: env.PUBLIC_APP_URL });
  return env.REFERRAL_PROGRAM && baseUrl ? { enabled: true, baseUrl } : { enabled: false, baseUrl: null };
}

/**
 * A referral code as typed, pasted or carried through a URL: trimmed and
 * lowercased (codes are lowercase letters and digits), or null when it cannot
 * be one. Bounded before any lookup, since it arrives from the browser.
 */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toLowerCase();
  return /^[a-z0-9]{1,32}$/.test(code) ? code : null;
}

/**
 * `/v1/me.referral`: what the dashboard draws for the program. `{ enabled:
 * false }` when it is switched off. Later steps of the program add fields
 * (unlocked, campaign, banner); a reader must ignore what it does not know.
 */
export type ReferralView =
  | { enabled: false }
  | {
      enabled: true;
      /** The person's referral link. */
      link: string;
      /** Referrals credited to the person so far. */
      count: number;
      /** Referrals the referral unlock needs. */
      goal: number;
    };

/**
 * The person's referral link and progress (ADR 0005: keyed by the person,
 * never by the workspace). The referrer row is created lazily, on the first
 * read with the program on; with it off nothing is read or written.
 */
@Injectable()
export class ReferralService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REFERRAL_OPTIONS) private readonly options: ReferralOptions,
    // Product analytics (`referral_signup`). Optional so a construction
    // without it (most specs) records referrals with no telemetry.
    @Optional() @Inject(AnalyticsEffects) private readonly analytics?: AnalyticsEffects,
  ) {}

  get enabled(): boolean {
    return this.options.enabled && this.options.baseUrl != null;
  }

  /** The block for the member making the request, in whichever workspace. */
  async forMember(accountId: string, memberId: string): Promise<ReferralView> {
    if (!this.enabled) return { enabled: false };
    const person = await referralPersonKey(this.db, accountId, memberId);
    if (!person) return { enabled: false };
    const row = await ensureReferrer(this.db, person, { now: this.options.now?.(), code: this.options.code });
    const link = buildReferralLink(this.options.baseUrl, row.code);
    if (!link) return { enabled: false };
    const count = await countReferrals(this.db, person);
    return { enabled: true, link, count, goal: REFERRAL_GOAL };
  }

  /**
   * Credit the member making the request to the owner of a referral code
   * (source `link`). `{ credited: false }` for every refusal; see
   * `creditReferral` for the rules.
   */
  async claimByLink(
    principal: { accountId: string; memberId: string },
    rawCode: unknown,
  ): Promise<{ credited: boolean }> {
    if (!this.enabled) return { credited: false };
    const code = normalizeReferralCode(rawCode);
    if (!code) return { credited: false };
    const referee = await referralPersonKey(this.db, principal.accountId, principal.memberId);
    const owner = await getReferrerByCode(this.db, code);
    if (!referee || !owner) return { credited: false };
    const now = this.options.now?.() ?? Date.now();
    const credited = await creditReferral(this.db, { referee, referrer: owner.personId, source: 'link', now });
    if (credited) await this.signupEvent(principal, owner.code, 'link', now);
    return { credited };
  }

  /**
   * `referral_signup`, about the invitee, once per credited referral. The
   * referrer's code rides on the event and on the invitee as `referred_by`,
   * so the funnel can be cut by referrer. The referrer gets `referral_code`
   * from the dashboard's identify (`identifyMember`), where their link is.
   * Never rejects: `capture` swallows its own failures.
   */
  private async signupEvent(
    principal: { accountId: string; memberId: string },
    code: string,
    source: ReferralSource,
    now: number,
  ): Promise<void> {
    if (!this.analytics?.enabled) return;
    const me = await getMe(this.db, principal.accountId, principal.memberId).catch(() => null);
    if (!me?.email) return;
    await this.analytics.capture(
      'referral_signup',
      {
        distinctId: me.email,
        accountId: principal.accountId,
        properties: { referral_code: code, referral_source: source },
        personProperties: { referred_by: code },
      },
      now,
    );
  }
}
