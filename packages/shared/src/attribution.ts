/**
 * Does a workspace's public surface carry the "Made with dForms" attribution?
 * The ONE rule every surface obeys: the badge on a form (slides, one page,
 * embed, the builder preview), the thank-you CTA, the link pages, and the
 * growth button in the submission emails. The API applies it and hands the
 * answer down as a plain `showAttribution` boolean; nothing else decides.
 *
 * dForms never charges. Hiding the attribution comes with a PAYING Dapta AI
 * subscription, and the paid verdict is cached on the workspace's `account`
 * row from what the identity service already tells dForms with the caller's
 * own token (`isPaid` on the workspace search, `account.account_status_id` on
 * the workspace detail). So the attribution is hidden only when BOTH hold:
 *  - the workspace asked for it (`hideAttribution`, its CHOICE), and
 *  - the deployment runs with `PREMIUM_FEATURES=open`, or the cached verdict
 *    reads paid and was written within `ATTRIBUTION_VERDICT_MAX_AGE_MS`.
 * Anything else shows it: a lapsed verdict, a stale one, one never written.
 *
 * The deploy-level rule (`NEXT_PUBLIC_SIGNUP_URL` / `NEXT_PUBLIC_HIDE_BADGE`,
 * see `growth.ts`) still applies on top: a deployment without the loop shows
 * nothing whatever this says.
 */

/**
 * How long a cached `paid` verdict counts.
 *
 * dForms learns the verdict only when a member of the workspace opens the
 * dashboard (the projection reads the identity service with their token), and
 * it is never told when a subscription ends. A public page decides from the
 * cache as it stands and never waits on anything upstream, so without a limit
 * a workspace whose subscription lapsed and that nobody opened again would
 * keep the attribution hidden forever.
 *
 * Thirty days, failing CLOSED: a verdict older than this reads as not paid, so
 * the attribution comes back until a member opens dForms again (which writes a
 * fresh verdict on that very request). A paying workspace that is in use never
 * notices; one nobody has opened in a month shows the badge again, which is
 * the cheap side to be wrong on.
 */
export const ATTRIBUTION_VERDICT_MAX_AGE_MS = 30 * 24 * 3_600_000;

/**
 * How far in the future a verdict's timestamp may sit and still count: a few
 * minutes of clock skew between the pods that write and read it. Anything
 * further ahead is a broken clock or corrupt data, and would otherwise read as
 * fresh for longer than the max age ever allows, so it counts as not paid.
 */
export const ATTRIBUTION_VERDICT_MAX_SKEW_MS = 5 * 60_000;

/** `PREMIUM_FEATURES`: `open` lets any workspace hide it; `locked` needs the paid verdict. */
export type PremiumMode = 'open' | 'locked';

export interface AttributionInput {
  /** The workspace's stored choice. */
  hideAttribution: boolean;
  /** The cached paid verdict: true, false, or null when it was never seen. */
  paid: boolean | null;
  /** Epoch ms the verdict was written, or null. */
  checkedAt: number | null;
  premiumMode: PremiumMode;
  /** Epoch ms of the decision. */
  now: number;
}

/** True when a `paid` verdict written at `checkedAt` still counts at `now`. */
export function paidVerdictFresh(paid: boolean | null, checkedAt: number | null, now: number): boolean {
  if (paid !== true || checkedAt == null || !Number.isFinite(checkedAt)) return false;
  const age = now - checkedAt;
  if (age < 0) return -age <= ATTRIBUTION_VERDICT_MAX_SKEW_MS;
  return age < ATTRIBUTION_VERDICT_MAX_AGE_MS;
}

/** May this workspace hide the attribution right now (the switch's "can turn it off")? */
export function canHideAttribution(input: Omit<AttributionInput, 'hideAttribution'>): boolean {
  return input.premiumMode === 'open' || paidVerdictFresh(input.paid, input.checkedAt, input.now);
}

/** Does the workspace's public surface carry the attribution? */
export function showAttribution(input: AttributionInput | null | undefined): boolean {
  if (!input || !input.hideAttribution) return true;
  return !canHideAttribution(input);
}
