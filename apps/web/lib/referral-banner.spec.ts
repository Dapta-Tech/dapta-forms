/**
 * Whether the dashboard draws the referral banner, from `/v1/me.referral`.
 * The API decides (`bannerVisible`: campaign, goal, unlock, paid, dismissed);
 * the web only refuses a banner the rest of the block contradicts, so an API
 * ahead of or behind this build never shows one that cannot apply.
 */
import { describe, expect, it } from 'vitest';
import type { MeReferral } from './admin-api';
import { referralBannerVisible } from './referral-banner';

const ON = {
  enabled: true,
  link: 'https://landing.example.test/?ref=abc23def',
  count: 3,
  goal: 5,
  campaignActive: true,
  bannerVisible: true,
} as const satisfies MeReferral;

describe('referralBannerVisible', () => {
  it('shows when the API says so', () => {
    expect(referralBannerVisible(ON)).toBe(true);
    expect(referralBannerVisible({ ...ON, count: 0 })).toBe(true);
    expect(referralBannerVisible({ ...ON, count: 4 })).toBe(true);
  });

  it('hides when the API says not to (paid workspace, dismissed, campaign over)', () => {
    expect(referralBannerVisible({ ...ON, bannerVisible: false })).toBe(false);
  });

  it('hides with the program off or no block at all', () => {
    expect(referralBannerVisible({ enabled: false })).toBe(false);
    expect(referralBannerVisible(undefined)).toBe(false);
  });

  it('hides at the goal', () => {
    expect(referralBannerVisible({ ...ON, count: 5 })).toBe(false);
    expect(referralBannerVisible({ ...ON, count: 7 })).toBe(false);
  });

  it('hides for a person who holds the referral unlock', () => {
    expect(referralBannerVisible({ ...ON, unlocked: true })).toBe(false);
    expect(referralBannerVisible({ ...ON, unlocked: false })).toBe(true);
  });

  it('hides once the campaign is over', () => {
    expect(referralBannerVisible({ ...ON, campaignActive: false })).toBe(false);
  });

  it('an API that does not send the flag yet shows no banner', () => {
    const { bannerVisible: _, ...older } = ON;
    expect(referralBannerVisible(older)).toBe(false);
  });
});
