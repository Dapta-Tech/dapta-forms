import { referralCodeOfLink } from './attribution';

/**
 * The referral program's live moments (a toast on a new referral, the
 * celebration at the goal) compare what the API says now with what the
 * person last saw IN THIS BROWSER. That last state is kept in localStorage,
 * per person: the key carries the code of their referral link, so two people
 * on one browser never see each other's moments.
 */
export const REFERRAL_SEEN_KEY_PREFIX = 'dforms.referral.seen.';

/** What the person last saw: their count, and whether they were unlocked. */
export interface ReferralSeen {
  count: number;
  unlocked: boolean;
}

/** What to show for a change, if anything. */
export type ReferralMoment =
  | { kind: 'none' }
  /** `joined` new referrals since the last look; `before` the count then. */
  | { kind: 'toast'; joined: number; before: number; count: number }
  | { kind: 'celebrate' };

/**
 * Compare the last state seen with the current one. No last state (the first
 * sight in this browser, or storage that cannot be read) shows nothing: the
 * current state is only remembered, so a person who already had 3 referrals,
 * or was already unlocked, is not greeted as if it just happened. The
 * celebration wins over the toast for the referral that reaches the goal.
 * An unlock is for life, so once seen it stays seen.
 */
export function referralMoment(
  last: ReferralSeen | null,
  now: ReferralSeen,
): { moment: ReferralMoment; next: ReferralSeen } {
  if (!last) return { moment: { kind: 'none' }, next: now };
  const next = { count: now.count, unlocked: last.unlocked || now.unlocked };
  if (now.unlocked && !last.unlocked) return { moment: { kind: 'celebrate' }, next };
  if (now.count > last.count) {
    return { moment: { kind: 'toast', joined: now.count - last.count, before: last.count, count: now.count }, next };
  }
  return { moment: { kind: 'none' }, next };
}

/** The storage key for the person behind this referral link. */
export function referralSeenKey(link: string): string {
  return `${REFERRAL_SEEN_KEY_PREFIX}${referralCodeOfLink(link) ?? link}`;
}

/** The last state seen, or null when there is none or storage fails. */
export function readReferralSeen(key: string): ReferralSeen | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ReferralSeen> | null;
    if (!v || typeof v.count !== 'number' || !Number.isFinite(v.count)) return null;
    return { count: v.count, unlocked: v.unlocked === true };
  } catch {
    return null;
  }
}

/** Remember the state seen; a storage that refuses it is ignored. */
export function writeReferralSeen(key: string, seen: ReferralSeen): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(seen));
  } catch {
    // Private mode, a full quota, storage blocked: no moment is worth an error.
  }
}

/** Fill a toast part. */
function fill(template: string, values: { joined: number; left: number }): string {
  return template.replaceAll('{joined}', String(values.joined)).replaceAll('{left}', String(values.left));
}

/**
 * The toast's text: who joined, then how many are left, in the reader's
 * language. After the goal was reached before, it says "someone else" and
 * counts nothing down.
 */
export function referralToastText(
  m: { one: string; many: string; oneMore: string; manyMore: string; left: string; lastOne: string },
  moment: { joined: number; before: number; count: number },
  goal: number,
): string {
  const { joined } = moment;
  const left = Math.max(0, goal - moment.count);
  if (moment.before >= goal) return fill(joined === 1 ? m.oneMore : m.manyMore, { joined, left });
  const who = fill(joined === 1 ? m.one : m.many, { joined, left });
  if (left <= 0) return who;
  return `${who}. ${fill(left === 1 ? m.lastOne : m.left, { joined, left })}`;
}
