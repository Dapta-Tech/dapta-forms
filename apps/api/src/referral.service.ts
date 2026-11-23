import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { referralCampaignEndsAt, type ServerEnv } from '@quill/config/env';
import {
  countReferrals,
  creditReferral,
  dismissReferralBanner,
  ensureReferrer,
  getAttributionSwitch,
  getMe,
  getReferrerByCode,
  personNames,
  recordReferralInvite,
  referralInviterOf,
  referralPersonKey,
  type Db,
  type ReferralSource,
  type ReferrerRow,
} from '@quill/db';
import { REFERRAL_GOAL, buildReferralLink, paidVerdictFresh, referralLinkBase } from '@quill/shared';
import { AnalyticsEffects } from './analytics-effects';
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
      /**
       * True while now is before the campaign end, or when none is set. Only
       * campaign-scoped surfaces (the top banner, the nudge email) key off it;
       * the link, the count and the menu entry stay after the campaign ends.
       */
      campaignActive: boolean;
      /**
       * Whether the top banner shows: the campaign is running, the person is
       * below the goal and holds no referral unlock, this workspace does not
       * pay for Dapta AI (a fresh paid verdict), and the person has not
       * dismissed it in the last `REFERRAL_BANNER_SNOOZE_MS`.
       */
      bannerVisible: boolean;
    };

/** How long closing the top banner hides it: 7 days. */
export const REFERRAL_BANNER_SNOOZE_MS = 7 * 86_400_000;

/** A referral code as the landing may send it: the alphabet of `generateReferralCode`, any case. */
const CODE_SHAPE = /^[a-z0-9]{1,32}$/i;

/**
 * The first word of a display name, or null when the name could be (or could
 * be made from) the person's email: the local development stub stores the
 * email as the name, and an invited member starts with the email's local
 * part. Null rather than a guess, so the landing greets nobody instead of
 * showing an address or a piece of one.
 */
function firstNameOf(displayName: string | null, emailLocals: ReadonlySet<string>): string | null {
  const name = displayName?.trim() ?? '';
  if (!name || name.includes('@') || emailLocals.has(name.toLowerCase())) return null;
  return name.split(/\s+/)[0] || null;
}

/**
 * The person's referral link and progress (ADR 0005: keyed by the person,
 * never by the workspace). The referrer row is created lazily, on the first
 * read with the program on; with it off nothing is read or written.
 */
@Injectable()
export class ReferralService {
  private readonly log = new Logger('ReferralService');

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
    return {
      enabled: true,
      link,
      count,
      goal: REFERRAL_GOAL,
      campaignActive: this.campaignActive(),
      bannerVisible: await this.bannerVisible(accountId, row, count),
    };
  }

  /**
   * The top banner's rule (see `ReferralView.bannerVisible`). The paid rule is
   * read for THIS workspace: a person who pays in one workspace and not in
   * another still sees the banner in the free one, where the badge shows.
   */
  private async bannerVisible(accountId: string, row: ReferrerRow, count: number): Promise<boolean> {
    if (!this.campaignActive()) return false;
    if (row.unlockedAt != null || count >= REFERRAL_GOAL) return false;
    const now = this.now();
    if (row.bannerDismissedUntil != null && now < row.bannerDismissedUntil) return false;
    const badge = await getAttributionSwitch(this.db, accountId);
    return !paidVerdictFresh(badge?.paid ?? null, badge?.paidCheckedAt ?? null, now);
  }

  /**
   * Close the top banner for the person making the request, in every
   * workspace, for `REFERRAL_BANNER_SNOOZE_MS`. With the program off nothing
   * is written and the answer carries no date.
   */
  async dismissBanner(accountId: string, memberId: string): Promise<{ dismissedUntil: number | null }> {
    if (!this.enabled) return { dismissedUntil: null };
    const person = await referralPersonKey(this.db, accountId, memberId);
    if (!person) return { dismissedUntil: null };
    const now = this.now();
    await ensureReferrer(this.db, person, { now, code: this.options.code });
    const dismissedUntil = now + REFERRAL_BANNER_SNOOZE_MS;
    await dismissReferralBanner(this.db, person, dismissedUntil);
    return { dismissedUntil };
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
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
    if (credited) {
      await this.afterCredited(owner.personId, now);
      await this.signupEvent(principal, owner.code, 'link', now);
    }
    return { credited };
  }

  /**
   * Record that the member making the request invited a teammate by email
   * (both invite paths: the identity service's and local development's). The
   * identity service's invitation has no inviter, so this record is the only
   * place one lives. The first inviter of an address keeps it. Never throws:
   * the invitation already went out, and a failure here must not undo it.
   */
  async recordInvite(principal: { accountId: string; memberId: string }, email: string): Promise<void> {
    if (!this.enabled) return;
    try {
      const inviter = await referralPersonKey(this.db, principal.accountId, principal.memberId);
      if (!inviter) return;
      const now = this.options.now?.() ?? Date.now();
      await recordReferralInvite(this.db, { email, inviter, accountId: principal.accountId, now });
    } catch (err) {
      this.log.error(`referral invite record failed: ${String(err)}`);
    }
  }

  /**
   * A person's first sign-in (`NewPersonObserver`): when a teammate invited
   * their address, credit that inviter with a referral of source `invite`.
   * The caller established that the person is new (no bound member row
   * before this sign-in), so the link's 10-minute window is not asked: the
   * adopted invite row keeps the invite's age. Self-invites, a person already
   * credited (by a link or anyone) and first-wins are `creditReferral`'s.
   * Never throws: it runs on the sign-in path.
   */
  async creditInvite(person: { accountId: string; memberId: string; email: string | null }): Promise<void> {
    if (!this.enabled) return;
    try {
      const inviter = await referralInviterOf(this.db, person.email);
      if (!inviter) return;
      const referee = await referralPersonKey(this.db, person.accountId, person.memberId);
      if (!referee) return;
      const now = this.options.now?.() ?? Date.now();
      const credited = await creditReferral(this.db, {
        referee,
        referrer: inviter,
        source: 'invite',
        now,
        newPerson: true,
      });
      if (!credited) return;
      await this.afterCredited(inviter, now);
      // The inviter's code rides on the event, as with a link, so the funnel
      // is cut by referrer the same way. Their link row is made if they never
      // opened it: it is theirs either way.
      const row = await ensureReferrer(this.db, inviter, { now, code: this.options.code });
      await this.signupEvent(person, row.code, 'invite', now);
    } catch (err) {
      this.log.error(`referral invite credit failed: ${String(err)}`);
    }
  }

  /**
   * What follows every credited referral, whichever its source: the one
   * place the next steps hang off (the unlock at the goal), so a link and an
   * invite can never drift apart.
   */
  private async afterCredited(_referrer: string, _now: number): Promise<void> {
    // The unlock at the goal lands here.
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

  /** Whether the campaign is running: no end set, or now is still before it. */
  campaignActive(): boolean {
    const endsAt = this.options.campaignEndsAt;
    return endsAt == null || (this.options.now?.() ?? Date.now()) < endsAt;
  }

  /**
   * The first name behind a referral code, for the landing's greeting. Null
   * for an unknown code, with the program off, and when the person has no
   * name that is safe to show. Nothing else about the person leaves here.
   */
  async firstNameForCode(code: string): Promise<string | null> {
    if (!this.enabled || !CODE_SHAPE.test(code)) return null;
    const referrer = await getReferrerByCode(this.db, code);
    if (!referrer) return null;
    const rows = await personNames(this.db, referrer.personId);
    // Any of the person's emails: a name made from one must not show up on another row either.
    const locals = new Set(rows.map((r) => r.email?.split('@')[0]?.trim().toLowerCase()).filter((l): l is string => !!l));
    for (const row of rows) {
      const first = firstNameOf(row.displayName, locals);
      if (first) return first;
    }
    return null;
  }
}
