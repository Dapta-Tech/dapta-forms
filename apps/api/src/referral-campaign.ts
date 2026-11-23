/**
 * Whether the referral campaign is running at `now`: no end is set
 * (`REFERRAL_CAMPAIGN_ENDS_AT` absent), or now is still before it. Only
 * campaign-scoped surfaces key off it (the top banner, the 7-day nudge); the
 * link, the count and earned unlocks outlive the campaign.
 */
export function referralCampaignActive(options: { campaignEndsAt?: number | null }, now: number): boolean {
  const endsAt = options.campaignEndsAt;
  return endsAt == null || now < endsAt;
}
