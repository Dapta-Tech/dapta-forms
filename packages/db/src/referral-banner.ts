/**
 * REFERRAL PROGRAM: the top banner's dismissal, on the person's referrer row
 * (`referrer.banner_dismissed_until`, 0030, ADR 0005). Per person, so closing
 * it in one workspace closes it in every workspace the person belongs to.
 */
import { sql } from 'drizzle-orm';
import type { Db } from './client';

/**
 * Hide the person's banner until `until` (epoch ms). The row must exist
 * (`ensureReferrer`); a person without one has nothing to dismiss. A second
 * dismissal replaces the date, so each close starts a fresh wait.
 */
export async function dismissReferralBanner(db: Db, personId: string, until: number): Promise<void> {
  await db.run(sql`UPDATE referrer SET banner_dismissed_until = ${until} WHERE person_id = ${personId}`);
}
