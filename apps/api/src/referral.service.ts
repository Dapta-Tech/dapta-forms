import { Inject, Injectable } from '@nestjs/common';
import type { ServerEnv } from '@quill/config/env';
import { ensureReferrer, getReferrerByCode, personNames, referralPersonKey, type Db } from '@quill/db';
import { REFERRAL_GOAL, buildReferralLink, referralLinkBase } from '@quill/shared';
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
    return { enabled: true, link, count: 0, goal: REFERRAL_GOAL };
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
