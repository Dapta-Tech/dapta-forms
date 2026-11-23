import type { MeReferral } from './admin-api';

/**
 * Whether the dashboard draws the referral banner. The API is the authority
 * (`bannerVisible` folds in the campaign, the goal, the unlock, a paying
 * workspace and a dismissal); the rest of the block can only veto it, so a
 * field the API adds later (`unlocked`) or a count already at the goal never
 * leaves a banner up that cannot apply. An API that sends no flag shows none.
 */
export function referralBannerVisible(referral: MeReferral | undefined): boolean {
  if (!referral?.enabled) return false;
  if (referral.bannerVisible !== true) return false;
  if (referral.campaignActive === false || referral.unlocked === true) return false;
  return referral.count < referral.goal;
}
