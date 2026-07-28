/**
 * Workspace brand kit storage + the snapshot apply/revert flow.
 *
 * The kit lives in `account_branding` (one row per account). Forms SNAPSHOT it:
 * `applyBrandKit` merges the kit's fields into each form's own
 * `config.branding` (and into a pending `draft_config` — otherwise the next
 * publish would silently revert the brand), after saving the previous branding
 * into `form.brand_backup` so the apply is reversible. The public renderer and
 * the engine never read this table.
 */
import { sql } from 'drizzle-orm';
import { BRAND_KIT_FIELDS, type BrandKit } from '@quill/types';
import type { Db } from './client';
import { parseJsonColumn, jsonParam } from './forms';

export interface AccountBrandingRow {
  accountId: string;
  config: BrandKit;
  createdAt: number;
  updatedAt: number;
}

/**
 * What `brand_backup` stores: the form's full `branding` object (live and, when
 * a draft was pending at apply time, the draft's) exactly as it was before the
 * apply. `themePreset` rides along inside these objects, so revert restores the
 * preset bookkeeping too.
 */
interface BrandBackup {
  live: Record<string, unknown> | null;
  draft: Record<string, unknown> | null;
}

export async function getAccountBranding(
  db: Db,
  accountId: string,
): Promise<AccountBrandingRow | null> {
  const r = await db.get<Record<string, unknown>>(
    sql`SELECT account_id, config, created_at, updated_at
        FROM account_branding WHERE account_id = ${accountId} LIMIT 1`,
  );
  if (!r) return null;
  return {
    accountId: String(r.account_id),
    config: parseJsonColumn<BrandKit>(r.config, {}),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

/** Create or replace the account's brand kit. Returns the stored row. */
export async function upsertAccountBranding(
  db: Db,
  accountId: string,
  config: BrandKit,
): Promise<AccountBrandingRow> {
  const now = Date.now();
  const existing = await getAccountBranding(db, accountId);
  if (existing) {
    await db.run(
      sql`UPDATE account_branding SET config = ${jsonParam(config)}, updated_at = ${now}
          WHERE account_id = ${accountId}`,
    );
  } else {
    await db.run(
      sql`INSERT INTO account_branding (account_id, config, created_at, updated_at)
          VALUES (${accountId}, ${jsonParam(config)}, ${now}, ${now})`,
    );
  }
  return (await getAccountBranding(db, accountId))!;
}

/**
 * Merge the kit into one branding object, field by field. Only the fields the
 * kit actually sets are overwritten — a kit that leaves `radius` absent does
 * not touch a form's own radius. `themePreset` is cleared because after an
 * apply the last-applied-preset bookkeeping no longer describes the colors.
 */
export function mergeKitIntoBranding(
  branding: Record<string, unknown> | null | undefined,
  kit: BrandKit,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(branding ?? {}) };
  for (const field of BRAND_KIT_FIELDS) {
    const value = (kit as Record<string, unknown>)[field];
    if (value !== undefined) next[field] = value;
  }
  delete next.themePreset;
  return next;
}

/** Restore ONLY the kit-managed fields (+ themePreset) from a backup branding. */
function restoreKitFields(
  current: Record<string, unknown> | null | undefined,
  backup: Record<string, unknown> | null,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(current ?? {}) };
  const source = backup ?? {};
  for (const field of [...BRAND_KIT_FIELDS, 'themePreset']) {
    if (field in source) next[field] = source[field];
    else delete next[field];
  }
  return next;
}

const asConfig = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const brandingOf = (config: Record<string, unknown> | null): Record<string, unknown> | null =>
  config ? (asConfig(config.branding) ?? null) : null;

export interface BrandApplyResult {
  /** Forms actually updated (found + owned by the account). */
  applied: string[];
}

/**
 * Snapshot-apply the account's brand kit to the given forms.
 *
 * Per form (single UPDATE each, scoped by account):
 *  - `brand_backup` ← the previous live + draft `branding` (only when no backup
 *    is already stored from an unreverted apply — re-applying must not clobber
 *    the true pre-brand state, or revert would "restore" an applied kit).
 *  - live `config.branding` ← kit fields merged over the form's own values.
 *  - `draft_config.branding` ← same merge, when a draft is pending. Without
 *    this, publishing the draft would silently undo the apply.
 *
 * Only the `branding` (and draft `branding`) key is rewritten — steps,
 * destinations (and their webhook secrets), cover, outcomes are copied through
 * untouched from what is already stored.
 */
export async function applyBrandKit(
  db: Db,
  accountId: string,
  formIds: string[],
): Promise<BrandApplyResult> {
  const kitRow = await getAccountBranding(db, accountId);
  if (!kitRow) return { applied: [] };
  const kit = kitRow.config;
  const applied: string[] = [];

  for (const id of formIds) {
    const r = await db.get<Record<string, unknown>>(
      sql`SELECT id, config, draft_config, brand_backup FROM form
          WHERE account_id = ${accountId} AND id = ${id} LIMIT 1`,
    );
    if (!r) continue;

    const config = asConfig(parseJsonColumn(r.config, null));
    if (!config) continue;
    const draft = r.draft_config == null ? null : asConfig(parseJsonColumn(r.draft_config, null));

    const existingBackup =
      r.brand_backup == null ? null : parseJsonColumn<BrandBackup | null>(r.brand_backup, null);
    const backup: BrandBackup = existingBackup ?? {
      live: brandingOf(config),
      draft: brandingOf(draft),
    };

    const nextConfig = { ...config, branding: mergeKitIntoBranding(brandingOf(config), kit) };
    const nextDraft = draft ? { ...draft, branding: mergeKitIntoBranding(brandingOf(draft), kit) } : null;

    const now = Date.now();
    await db.run(
      sql`UPDATE form
          SET config = ${jsonParam(nextConfig)},
              draft_config = ${nextDraft ? jsonParam(nextDraft) : null},
              brand_backup = ${jsonParam(backup)},
              brand_applied_at = ${now},
              updated_at = ${now}
          WHERE account_id = ${accountId} AND id = ${id}`,
    );
    applied.push(id);
  }
  return { applied };
}

export interface BrandRevertResult {
  /** Forms actually restored (had a backup to restore). */
  reverted: string[];
}

/**
 * Undo the last apply on the given forms: restore the kit-managed branding
 * fields from `brand_backup` (live config, and a pending draft when one exists —
 * a draft created AFTER the apply branched off the branded live config, so it
 * is restored from the live backup). One level of undo: the backup is cleared.
 */
export async function revertBrandKit(
  db: Db,
  accountId: string,
  formIds: string[],
): Promise<BrandRevertResult> {
  const reverted: string[] = [];

  for (const id of formIds) {
    const r = await db.get<Record<string, unknown>>(
      sql`SELECT id, config, draft_config, brand_backup FROM form
          WHERE account_id = ${accountId} AND id = ${id} LIMIT 1`,
    );
    if (!r || r.brand_backup == null) continue;
    const backup = parseJsonColumn<BrandBackup | null>(r.brand_backup, null);
    if (!backup) continue;

    const config = asConfig(parseJsonColumn(r.config, null));
    if (!config) continue;
    const draft = r.draft_config == null ? null : asConfig(parseJsonColumn(r.draft_config, null));

    const nextConfig = {
      ...config,
      branding: restoreKitFields(brandingOf(config), backup.live),
    };
    const nextDraft = draft
      ? { ...draft, branding: restoreKitFields(brandingOf(draft), backup.draft ?? backup.live) }
      : null;

    await db.run(
      sql`UPDATE form
          SET config = ${jsonParam(nextConfig)},
              draft_config = ${nextDraft ? jsonParam(nextDraft) : null},
              brand_backup = NULL,
              brand_applied_at = NULL,
              updated_at = ${Date.now()}
          WHERE account_id = ${accountId} AND id = ${id}`,
    );
    reverted.push(id);
  }
  return { reverted };
}
