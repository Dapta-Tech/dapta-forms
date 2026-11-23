'use server';

import { unstable_rethrow } from 'next/navigation';
import { adminApi, type MeReferral } from '@/lib/admin-api';

/**
 * Close the referral banner for the person, in every workspace, for 7 days.
 * The banner is already gone on the client; this is what keeps it gone on the
 * next load and in another browser. A failure is swallowed: the worst case is
 * the banner coming back on the next load, never an error on the page.
 *
 * No revalidation, for the same reason as `recordAnnouncementAction`.
 */
export async function dismissReferralBanner(): Promise<{ ok: boolean }> {
  try {
    await adminApi.dismissReferralBanner();
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false };
  }
}

/**
 * The person's referral progress, read again by the dashboard when its window
 * gets focus (`ReferralMoments`), so a new referral shows without a reload.
 * Null on any failure: a missed read only delays a toast.
 */
export async function readReferralProgress(): Promise<MeReferral | null> {
  try {
    return (await adminApi.me()).referral ?? null;
  } catch (e) {
    unstable_rethrow(e);
    return null;
  }
}
