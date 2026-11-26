/**
 * PLAYBOOKS: what each person has opened in the in-app gallery (0035).
 *
 * The playbooks are defined in code (@quill/shared/playbooks); this module only
 * stores the per-person state the API decides with. The person key is the one
 * the announcements use (`announcementUserKey`), so a person's state is the
 * same in every workspace they belong to (ADR 0006).
 *
 * Every write is a single upsert: the first time is kept, and the last time
 * only moves forward, so two tabs reporting at once, or a late replay, cannot
 * move either one backwards.
 */
import { sql } from 'drizzle-orm';
import type { Db } from './client';

/**
 * The reserved slug of the gallery itself: its row holds the person's visits
 * to the gallery, which decide what is "New". Playbook slugs are lowercase
 * words joined by hyphens, so none can be this.
 */
export const PLAYBOOK_GALLERY_SLUG = '_gallery';

/** One person's state for one playbook (or for the gallery). */
export interface PlaybookStateRow {
  playbookSlug: string;
  firstSeenAt: number;
  lastSeenAt: number;
}

interface StateDbRow {
  playbook_slug: string;
  first_seen_at: number | string;
  last_seen_at: number | string;
}

/** Postgres returns BIGINT as a string; SQLite as a number. */
const toRow = (r: StateDbRow): PlaybookStateRow => ({
  playbookSlug: r.playbook_slug,
  firstSeenAt: Number(r.first_seen_at),
  lastSeenAt: Number(r.last_seen_at),
});

/** Every playbook state stored for this person, the gallery's row included. */
export async function listPlaybookStates(db: Db, userId: string): Promise<PlaybookStateRow[]> {
  const rows = await db.all<StateDbRow>(
    sql`SELECT playbook_slug, first_seen_at, last_seen_at FROM playbook_state WHERE user_id = ${userId}`,
  );
  return rows.map(toRow);
}

/**
 * Record that this person opened this playbook (or the gallery) at `now`.
 * Idempotent: `first_seen_at` is set once and never moves; `last_seen_at`
 * becomes the later of what it was and `now`. Returns the stored state and
 * whether this call was the first open.
 *
 * `first` is decided by the insert itself (`ON CONFLICT DO NOTHING
 * RETURNING`, the same in both dialects): of two opens at once, exactly one
 * inserts the row, so exactly one reports `first: true`.
 */
export async function recordPlaybookSeen(
  db: Db,
  userId: string,
  playbookSlug: string,
  now: number,
): Promise<PlaybookStateRow & { first: boolean }> {
  const inserted = await db.get<StateDbRow>(
    sql`INSERT INTO playbook_state (user_id, playbook_slug, first_seen_at, last_seen_at)
        VALUES (${userId}, ${playbookSlug}, ${now}, ${now})
        ON CONFLICT (user_id, playbook_slug) DO NOTHING
        RETURNING playbook_slug, first_seen_at, last_seen_at`,
  );
  if (inserted) return { ...toRow(inserted), first: true };
  // A CASE rather than GREATEST / MAX(a, b): the two dialects spell the
  // two-argument maximum differently, and this reads the same in both.
  await db.run(
    sql`UPDATE playbook_state
        SET last_seen_at = CASE WHEN last_seen_at > ${now} THEN last_seen_at ELSE ${now} END
        WHERE user_id = ${userId} AND playbook_slug = ${playbookSlug}`,
  );
  const after = await db.get<StateDbRow>(
    sql`SELECT playbook_slug, first_seen_at, last_seen_at FROM playbook_state
        WHERE user_id = ${userId} AND playbook_slug = ${playbookSlug}`,
  );
  if (!after) throw new Error('playbook_state row vanished after its insert');
  return { ...toRow(after), first: false };
}
