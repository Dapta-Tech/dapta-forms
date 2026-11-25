/**
 * REFERRAL PROGRAM: the browsers each person was seen in (0034, ADR 0005).
 *
 * The web app keeps a random, opaque, first-party browser id in a long-lived
 * cookie and forwards it to the API, which hashes it (SHA-256) before it
 * reaches here: only the hash is stored. A referral whose browser is among the
 * referrer's is refused (`creditReferralVerdict`), which stops one person from
 * opening several accounts in their own browser to reach the referral unlock.
 * A network address is never a signal: coworkers on one office network are
 * real referrals.
 *
 * Keyed by the person, like the rest of the referral state.
 */
import { sql } from 'drizzle-orm';
import type { Db } from './client';

/** How many browsers a person keeps: the most recently seen win. */
export const REFERRER_BROWSER_CAP = 20;

/**
 * How stale `last_seen_at` may get before a dashboard load writes it again: an
 * hour. The record is read as "was this browser ever theirs", so the refresh
 * only orders the cap, and most page loads write nothing.
 */
export const REFERRER_BROWSER_REFRESH_MS = 60 * 60_000;

/**
 * Record that a person was seen in a browser (its hash); true when this call
 * wrote a row (a new browser, or a refresh of a stale one). One upsert, guarded
 * so a fresh row is left alone. A new or refreshed row then trims the person to
 * their `REFERRER_BROWSER_CAP` most recently seen browsers.
 */
export async function recordPersonBrowser(
  db: Db,
  input: { person: string; browserHash: string; now?: number },
): Promise<boolean> {
  const now = input.now ?? Date.now();
  const row = await db.get<{ person_id: string }>(
    sql`INSERT INTO referrer_browser (person_id, browser_hash, first_seen_at, last_seen_at)
        VALUES (${input.person}, ${input.browserHash}, ${now}, ${now})
        ON CONFLICT (person_id, browser_hash) DO UPDATE SET last_seen_at = excluded.last_seen_at
          WHERE referrer_browser.last_seen_at < ${now - REFERRER_BROWSER_REFRESH_MS}
        RETURNING person_id`,
  );
  if (!row) return false;
  await db.run(
    sql`DELETE FROM referrer_browser
        WHERE person_id = ${input.person}
          AND browser_hash NOT IN (
            SELECT browser_hash FROM referrer_browser
            WHERE person_id = ${input.person}
            ORDER BY last_seen_at DESC, first_seen_at DESC, browser_hash
            LIMIT ${REFERRER_BROWSER_CAP}
          )`,
  );
  return true;
}

/** Whether a person was ever seen in this browser (its hash), within their kept browsers. */
export async function personBrowserSeen(db: Db, person: string, browserHash: string): Promise<boolean> {
  const r = await db.get<{ one: number }>(
    sql`SELECT 1 AS one FROM referrer_browser
        WHERE person_id = ${person} AND browser_hash = ${browserHash}
        LIMIT 1`,
  );
  return Boolean(r);
}
