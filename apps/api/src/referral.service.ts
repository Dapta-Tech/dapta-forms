import { Inject, Injectable } from '@nestjs/common';
import { referralCampaignEndsAt, type ServerEnv } from '@quill/config/env';
import { ensureReferrer, referralPersonKey, type Db } from '@quill/db';
import { REFERRAL_GOAL, buildReferralLink, referralLinkBase } from '@quill/shared';
import { DB, REFERRAL_OPTIONS } from './tokens';

/** The referral program's switch and where its links point, resolved once from env. */
export interface ReferralOptions {
  /** `REFERRAL_PROGRAM`, and a base to link to. Off by default. */
  enabled: boolean;
  /** The landing, else the app (`referralLinkBase`). Null only when off. */
  baseUrl: string | null;
  /**
   * `REFERRAL_CAMPAIGN_ENDS_AT` in epoch ms: the campaign runs while now is
   * before it. Absent or null means no end.
   */
  campaignEndsAt?: number | null;
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
  env: Pick<ServerEnv, 'REFERRAL_PROGRAM' | 'PUBLIC_APP_URL'> &
    Partial<Pick<ServerEnv, 'NEXT_PUBLIC_LANDING_URL' | 'REFERRAL_CAMPAIGN_ENDS_AT'>>,
): ReferralOptions {
  // Parsed even with the program off, so a bad value fails before it is turned on.
  const campaignEndsAt = referralCampaignEndsAt(env);
  const baseUrl = referralLinkBase({ landingUrl: env.NEXT_PUBLIC_LANDING_URL, appUrl: env.PUBLIC_APP_URL });
  const end = campaignEndsAt == null ? {} : { campaignEndsAt };
  return env.REFERRAL_PROGRAM && baseUrl
    ? { enabled: true, baseUrl, ...end }
    : { enabled: false, baseUrl: null, ...end };
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
      /**
       * True while now is before the campaign end, or when none is set. Only
       * campaign-scoped surfaces (the top banner, the nudge email) key off it;
       * the link, the count and the menu entry stay after the campaign ends.
       */
      campaignActive: boolean;
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
    // The count arrives with referrals (they are not recorded yet).
    return { enabled: true, link, count: 0, goal: REFERRAL_GOAL, campaignActive: this.campaignActive() };
  }

  /** Whether the campaign is running: no end set, or now is still before it. */
  campaignActive(): boolean {
    const endsAt = this.options.campaignEndsAt;
    return endsAt == null || (this.options.now?.() ?? Date.now()) < endsAt;
  }
}
