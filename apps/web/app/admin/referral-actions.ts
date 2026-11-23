'use server';

import { unstable_rethrow } from 'next/navigation';
import { adminApi } from '@/lib/admin-api';

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
