/**
 * Revert a form to its previously published version.
 *
 * `publishForm` keeps the live config it replaces in `previous_config`, dated
 * in `previous_published_at_ms`. A revert swaps the pair with the live one:
 * the previous version goes live, and the version it replaces becomes the
 * previous, so a second revert undoes the first. The dates travel with their
 * versions (`published_at` and `previous_published_at_ms` swap too).
 *
 * Two things are deliberately left alone:
 *
 * - **Destinations.** They are edited live on the integrations screen, never
 *   staged in a draft, and a stored version can predate a webhook someone
 *   connected since. The live set is carried over the restored version, the
 *   same rule `publishForm` applies to a draft.
 * - **The pending draft.** It is somebody's unpublished work; a revert changes
 *   what the public sees, not what the editor holds.
 */
import { sql, type Db } from './client';
import { getFormById, jsonParam, parseJsonColumn, type FormRow } from './forms';

/** `revertForm`'s answer. NOTHING_TO_REVERT: the form has no previous version. */
export type RevertResult =
  | { ok: true; value: FormRow }
  | { ok: false; reason: 'NOTHING_TO_REVERT'; message: string }
  | { ok: false; reason: 'NOT_FOUND' | 'STALE'; message?: string };

/**
 * How many times a swap is retried when another write lands between its read
 * and its UPDATE. Each retry re-reads, so the swap is always computed on the
 * row it writes; past this many the caller gets STALE rather than a loop.
 */
const REVERT_ATTEMPTS = 3;

export async function revertForm(db: Db, accountId: string, id: string): Promise<RevertResult> {
  for (let attempt = 0; attempt < REVERT_ATTEMPTS; attempt++) {
    const row = await db.get<{ config: unknown; previous_config: unknown; updated_at: unknown }>(
      sql`SELECT config, previous_config, updated_at FROM form
          WHERE account_id = ${accountId} AND id = ${id} LIMIT 1`,
    );
    if (!row) return { ok: false, reason: 'NOT_FOUND' };
    const previous = parseJsonColumn<unknown>(row.previous_config, null);
    if (!previous || typeof previous !== 'object' || Array.isArray(previous)) {
      return {
        ok: false,
        reason: 'NOTHING_TO_REVERT',
        message: 'This form has no earlier published version to go back to.',
      };
    }

    const live = parseJsonColumn<Record<string, unknown> | null>(row.config, null);
    const next: Record<string, unknown> = { ...(previous as Record<string, unknown>) };
    if (live && live.destinations !== undefined) next.destinations = live.destinations;
    else delete next.destinations;

    // One UPDATE, every right-hand side read from the row as it was: that is
    // what makes the swap a swap on both dialects. Guarded by the stamp read
    // above, so a write landing in between (a draft save, a destinations edit)
    // makes this miss and go round again on the fresh row, instead of
    // restoring destinations that were just changed.
    const fired = await db.get<{ id: string }>(
      sql`UPDATE form
          SET config = ${jsonParam(next)},
              previous_config = config,
              published_at = previous_published_at_ms,
              previous_published_at_ms = published_at,
              updated_at = ${Date.now()}
          WHERE account_id = ${accountId} AND id = ${id}
            AND previous_config IS NOT NULL
            AND updated_at = ${Number(row.updated_at)}
          RETURNING id`,
    );
    if (fired) return { ok: true, value: (await getFormById(db, accountId, id))! };
  }
  return { ok: false, reason: 'STALE', message: 'This form was saved elsewhere since you loaded it.' };
}
