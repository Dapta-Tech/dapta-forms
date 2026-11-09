import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_VERDICT_MAX_AGE_MS,
  ATTRIBUTION_VERDICT_MAX_SKEW_MS,
  canHideAttribution,
  paidVerdictFresh,
  showAttribution,
  type AttributionInput,
} from './attribution';

const NOW = 1_800_000_000_000;
const base: AttributionInput = { hideAttribution: false, paid: null, checkedAt: null, premiumMode: 'locked', now: NOW };

describe('showAttribution', () => {
  it('shows it when there is no row at all', () => {
    expect(showAttribution(null)).toBe(true);
    expect(showAttribution(undefined)).toBe(true);
  });

  it('shows it whenever the workspace did not ask to hide it, in every mode and verdict', () => {
    for (const premiumMode of ['open', 'locked'] as const) {
      for (const paid of [true, false, null]) {
        expect(showAttribution({ ...base, premiumMode, paid, checkedAt: NOW })).toBe(true);
      }
    }
  });

  it('open mode: asking is enough, with no verdict at all', () => {
    expect(showAttribution({ ...base, premiumMode: 'open', hideAttribution: true })).toBe(false);
    expect(showAttribution({ ...base, premiumMode: 'open', hideAttribution: true, paid: false, checkedAt: NOW })).toBe(false);
  });

  it('locked mode: hidden only with a fresh paid verdict', () => {
    expect(showAttribution({ ...base, hideAttribution: true, paid: true, checkedAt: NOW - 1000 })).toBe(false);
  });

  it('locked mode, lapsed: the choice stays stored but the attribution shows', () => {
    expect(showAttribution({ ...base, hideAttribution: true, paid: false, checkedAt: NOW })).toBe(true);
  });

  it('locked mode, never seen: a null verdict shows it', () => {
    expect(showAttribution({ ...base, hideAttribution: true, paid: null, checkedAt: null })).toBe(true);
    // A paid flag without a timestamp is not a verdict either.
    expect(showAttribution({ ...base, hideAttribution: true, paid: true, checkedAt: null })).toBe(true);
  });

  it('locked mode, stale: a paid verdict older than the max age fails closed', () => {
    const justInside = NOW - ATTRIBUTION_VERDICT_MAX_AGE_MS + 1;
    const atLimit = NOW - ATTRIBUTION_VERDICT_MAX_AGE_MS;
    expect(showAttribution({ ...base, hideAttribution: true, paid: true, checkedAt: justInside })).toBe(false);
    expect(showAttribution({ ...base, hideAttribution: true, paid: true, checkedAt: atLimit })).toBe(true);
  });

  it('the max age is thirty days', () => {
    expect(ATTRIBUTION_VERDICT_MAX_AGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe('paidVerdictFresh / canHideAttribution', () => {
  it('only a true verdict with a timestamp inside the window is fresh', () => {
    expect(paidVerdictFresh(true, NOW, NOW)).toBe(true);
    expect(paidVerdictFresh(false, NOW, NOW)).toBe(false);
    expect(paidVerdictFresh(null, NOW, NOW)).toBe(false);
    expect(paidVerdictFresh(true, Number.NaN, NOW)).toBe(false);
  });

  it('a timestamp slightly in the future (clock skew, up to 5 minutes) still counts', () => {
    expect(paidVerdictFresh(true, NOW + 5000, NOW)).toBe(true);
    expect(paidVerdictFresh(true, NOW + ATTRIBUTION_VERDICT_MAX_SKEW_MS, NOW)).toBe(true);
  });

  it('a timestamp more than 5 minutes in the future (broken clock, corrupt data) does not', () => {
    expect(ATTRIBUTION_VERDICT_MAX_SKEW_MS).toBe(5 * 60 * 1000);
    expect(paidVerdictFresh(true, NOW + ATTRIBUTION_VERDICT_MAX_SKEW_MS + 1, NOW)).toBe(false);
    expect(paidVerdictFresh(true, NOW + 365 * 24 * 3_600_000, NOW)).toBe(false);
    expect(
      showAttribution({ hideAttribution: true, paid: true, checkedAt: NOW + 3_600_000, premiumMode: 'locked', now: NOW }),
    ).toBe(true);
  });

  it('open mode can always hide; locked needs the fresh verdict', () => {
    expect(canHideAttribution({ paid: null, checkedAt: null, premiumMode: 'open', now: NOW })).toBe(true);
    expect(canHideAttribution({ paid: false, checkedAt: NOW, premiumMode: 'locked', now: NOW })).toBe(false);
    expect(canHideAttribution({ paid: true, checkedAt: NOW, premiumMode: 'locked', now: NOW })).toBe(true);
  });
});
