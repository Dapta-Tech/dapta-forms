/**
 * The workspace's "Made with dForms" attribution switch and the paid verdict
 * it depends on (migration 0028).
 *
 * Two facts on one row, kept apart on purpose:
 *  - `hide_attribution` is the workspace's CHOICE. It survives a lapsed
 *    subscription, so a workspace that pays again gets it back untouched.
 *  - `dapta_paid` / `dapta_paid_checked_at` is the cached VERDICT: the last
 *    thing the identity service said about whether the workspace's owning
 *    account pays for Dapta AI, written by the workspace projection from the
 *    rows it already reads with the caller's own token (`cacheDaptaPaid`).
 *    Only the boolean is stored, never a plan, a status or a billing id.
 *
 * Whether a surface shows the attribution is decided from both by
 * `showAttribution` in @quill/shared, never here.
 */
import { sql, type Db } from './client';

export interface AttributionSwitchRow {
  accountId: string;
  hideAttribution: boolean;
  /** The cached verdict, or null when the identity service never gave one. */
  paid: boolean | null;
  /** Epoch ms the verdict was written, or null. */
  paidCheckedAt: number | null;
}

interface RawRow {
  id: string;
  hide_attribution: number | string | null;
  dapta_paid: number | string | null;
  dapta_paid_checked_at: number | string | null;
}

function toRow(r: RawRow): AttributionSwitchRow {
  return {
    accountId: String(r.id),
    hideAttribution: Number(r.hide_attribution) === 1,
    paid: r.dapta_paid == null ? null : Number(r.dapta_paid) === 1,
    paidCheckedAt: r.dapta_paid_checked_at == null ? null : Number(r.dapta_paid_checked_at),
  };
}

/** The workspace's switch and cached verdict, by account id (null: no such account). */
export async function getAttributionSwitch(db: Db, accountId: string): Promise<AttributionSwitchRow | null> {
  const r = await db.get<RawRow>(
    sql`SELECT id, hide_attribution, dapta_paid, dapta_paid_checked_at
        FROM account WHERE id = ${accountId} LIMIT 1`,
  );
  return r ? toRow(r) : null;
}

/** Store the workspace's choice. Whether it is honoured is the render's call. */
export async function setHideAttribution(db: Db, accountId: string, hide: boolean): Promise<void> {
  await db.run(sql`UPDATE account SET hide_attribution = ${hide ? 1 : 0} WHERE id = ${accountId}`);
}

/** Cache the identity service's paid verdict for one workspace, stamped `now`. */
export async function cacheDaptaPaid(db: Db, accountId: string, paid: boolean, now: number = Date.now()): Promise<void> {
  await db.run(
    sql`UPDATE account SET dapta_paid = ${paid ? 1 : 0}, dapta_paid_checked_at = ${now} WHERE id = ${accountId}`,
  );
}
