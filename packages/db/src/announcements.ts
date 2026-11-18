/**
 * IN-APP ANNOUNCEMENTS: what each person did with each announcement (0029).
 *
 * The announcements are defined in code (@quill/shared); this module only
 * stores the per-person state the API decides with. Every write is a single
 * upsert, so two tabs reporting at once cannot overwrite an
 * earlier close with a later one.
 */
import { sql } from 'drizzle-orm';
import type { Db } from './client';

/** One person's state for one announcement. Mirrors `AnnouncementUserState` in @quill/shared. */
export interface AnnouncementStateRow {
  announcementId: string;
  seenAt: number | null;
  dismissedAt: number | null;
  clickedAt: number | null;
}

interface StateDbRow {
  announcement_id: string;
  seen_at: number | string | null;
  dismissed_at: number | string | null;
  clicked_at: number | string | null;
}

/** Postgres returns BIGINT as a string; SQLite as a number. */
const num = (v: number | string | null): number | null => (v == null ? null : Number(v));

/**
 * The key announcements are stored under for one member: the identity
 * service's user id when the member carries one (so a person in several
 * workspaces is one person), else the member row itself.
 */
export async function announcementUserKey(db: Db, accountId: string, memberId: string): Promise<string> {
  const r = await db.get<{ external_id: string | null }>(
    sql`SELECT external_id FROM member WHERE id = ${memberId} AND account_id = ${accountId} LIMIT 1`,
  );
  const external = r?.external_id?.trim();
  return external ? external : `member:${memberId}`;
}

/** Every announcement state stored for this person. */
export async function listAnnouncementStates(db: Db, userId: string): Promise<AnnouncementStateRow[]> {
  const rows = await db.all<StateDbRow>(
    sql`SELECT announcement_id, seen_at, dismissed_at, clicked_at
        FROM announcement_state WHERE user_id = ${userId}`,
  );
  return rows.map((r) => ({
    announcementId: r.announcement_id,
    seenAt: num(r.seen_at),
    dismissedAt: num(r.dismissed_at),
    clickedAt: num(r.clicked_at),
  }));
}

/**
 * Record one moment for this person and announcement: the pop-up first on
 * screen (`seen`), closed (`dismissed`), or its page reached (`clicked`). The
 * first time is the one kept, so a second tab or a replayed report never
 * moves it. One upsert, so two tabs reporting at once cannot lose a write.
 */
export async function recordAnnouncementEvent(
  db: Db,
  userId: string,
  announcementId: string,
  event: 'seen' | 'dismissed' | 'clicked',
  now: number,
): Promise<void> {
  // Interpolated, not parameterized: a column name cannot be a bind parameter,
  // and the value is chosen from a closed union here, never from input.
  const col = sql.raw(event === 'seen' ? 'seen_at' : event === 'dismissed' ? 'dismissed_at' : 'clicked_at');
  await db.run(
    sql`INSERT INTO announcement_state
          (user_id, announcement_id, ${col}, created_at, updated_at)
        VALUES (${userId}, ${announcementId}, ${now}, ${now}, ${now})
        ON CONFLICT (user_id, announcement_id) DO UPDATE SET
          ${col} = COALESCE(announcement_state.${col}, ${now}),
          updated_at = ${now}`,
  );
}
