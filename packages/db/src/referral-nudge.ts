/**
 * REFERRAL PROGRAM: the 7-day nudge's once-per-person stamp, on the person's
 * referrer row (`referrer.nudge_sent_at`, 0030, ADR 0005).
 *
 * The outbox row that carries a nudge is scheduled on a credit and checked
 * again when it comes due. This stamp is the check that makes the send happen
 * at most once per person, however many replicas or retries reach it.
 */
import { sql } from 'drizzle-orm';
import type { Db } from './client';

/**
 * Take the person's one nudge at `now`, if it still applies: true only for
 * the call that wrote the stamp. One guarded UPDATE decides it, so two
 * replicas delivering at once cannot both win. It applies while:
 *   - no nudge was stamped before (`nudge_sent_at IS NULL`);
 *   - the person holds no referral unlock;
 *   - their referral count is still `count`, the count that scheduled it:
 *     referrals are never deleted, so a different count means a newer one;
 *   - `count` is between 1 and `goal - 1`.
 * The person needs a referrer row; without one nothing is written.
 */
export async function claimReferralNudge(
  db: Db,
  input: { person: string; count: number; goal: number; now: number },
): Promise<boolean> {
  if (!Number.isInteger(input.count) || input.count < 1 || input.count >= input.goal) return false;
  const row = await db.get<{ person_id: string }>(
    sql`UPDATE referrer SET nudge_sent_at = ${input.now}
        WHERE person_id = ${input.person} AND nudge_sent_at IS NULL AND unlocked_at IS NULL
          AND (SELECT COUNT(*) FROM referral WHERE referrer_person_id = ${input.person}) = ${input.count}
        RETURNING person_id`,
  );
  return Boolean(row);
}

/**
 * Give the nudge back after a send that failed, so the outbox retry can take
 * it again. Only the stamp this call wrote (`stampedAt`) is cleared, never a
 * later one.
 */
export async function releaseReferralNudge(db: Db, person: string, stampedAt: number): Promise<void> {
  await db.run(
    sql`UPDATE referrer SET nudge_sent_at = NULL WHERE person_id = ${person} AND nudge_sent_at = ${stampedAt}`,
  );
}

/** Whether the person's one nudge has gone out (or is going out). */
export async function referralNudgeSent(db: Db, person: string): Promise<boolean> {
  const row = await db.get<{ nudge_sent_at: number | string | null }>(
    sql`SELECT nudge_sent_at FROM referrer WHERE person_id = ${person}`,
  );
  return row?.nudge_sent_at != null;
}
