/**
 * Per-account NOTIFICATION SETTINGS — the storage behind Settings →
 * Notifications (per-key toggle + template controls). One row per (account,
 * email_key); an ABSENT row means "shipped default": enabled, stock template.
 * `subject`/`body` NULL = stock template (so "reset to default" is just
 * NULLing them); `reminder_lead_minutes` is a JSON array of minutes-before-
 * start, meaningful only on the reminder key.
 *
 * This module is pure storage and deliberately does NOT know the catalog of
 * valid keys or the shipped template copy — those live in @quill/notifications
 * (the rendering side); the API layer validates keys before writing. Keeping
 * the dependency pointing that way avoids a db↔notifications cycle.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from './client';

export interface NotificationSetting {
  emailKey: string;
  enabled: boolean;
  /** NULL = shipped default template. */
  subject: string | null;
  body: string | null;
  /** Minutes before start, ascending not required; NULL = shipped default leads. */
  reminderLeadMinutes: number[] | null;
  updatedAt: number | null;
}

export interface NotificationSettingPatch {
  enabled?: boolean;
  /** NULL resets to the shipped default; undefined leaves untouched. */
  subject?: string | null;
  body?: string | null;
  reminderLeadMinutes?: number[] | null;
}

/** A safe default when no row exists (fork/default behavior: everything ON). */
export function defaultNotificationSetting(emailKey: string): NotificationSetting {
  return { emailKey, enabled: true, subject: null, body: null, reminderLeadMinutes: null, updatedAt: null };
}

function parseLeads(raw: unknown): number[] | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return null;
    const leads = arr.map(Number).filter((n) => Number.isFinite(n) && n > 0);
    return leads.length > 0 ? leads : null;
  } catch {
    return null;
  }
}

function mapRow(r: Record<string, unknown>): NotificationSetting {
  return {
    emailKey: String(r.email_key),
    enabled: Number(r.enabled) !== 0,
    subject: (r.subject as string | null) ?? null,
    body: (r.body as string | null) ?? null,
    reminderLeadMinutes: parseLeads(r.reminder_lead_minutes),
    updatedAt: r.updated_at == null ? null : Number(r.updated_at),
  };
}

/** All stored settings for an account, keyed by email_key (absent = default). */
export async function getNotificationSettings(
  db: Db,
  accountId: string,
): Promise<Map<string, NotificationSetting>> {
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT email_key, enabled, subject, body, reminder_lead_minutes, updated_at
        FROM notification_setting WHERE account_id = ${accountId}`,
  );
  return new Map(rows.map((r) => [String(r.email_key), mapRow(r)]));
}

/** One setting with the default fallback — never null. */
export async function getNotificationSetting(
  db: Db,
  accountId: string,
  emailKey: string,
): Promise<NotificationSetting> {
  const row = await db.get<Record<string, unknown>>(
    sql`SELECT email_key, enabled, subject, body, reminder_lead_minutes, updated_at
        FROM notification_setting
        WHERE account_id = ${accountId} AND email_key = ${emailKey} LIMIT 1`,
  );
  return row ? mapRow(row) : defaultNotificationSetting(emailKey);
}

/**
 * Create-or-update the (account, email_key) row applying only the fields
 * present in the patch. Portable upsert: UPDATE first, INSERT (merged with
 * defaults) when nothing matched — single-process semantics are fine on both
 * engines here (settings writes come from one admin screen, not a hot path).
 */
export async function upsertNotificationSetting(
  db: Db,
  accountId: string,
  emailKey: string,
  patch: NotificationSettingPatch,
  now = Date.now(),
): Promise<NotificationSetting> {
  const sets = [];
  if (patch.enabled !== undefined) sets.push(sql`enabled = ${patch.enabled ? 1 : 0}`);
  if (patch.subject !== undefined) sets.push(sql`subject = ${patch.subject}`);
  if (patch.body !== undefined) sets.push(sql`body = ${patch.body}`);
  if (patch.reminderLeadMinutes !== undefined)
    sets.push(
      sql`reminder_lead_minutes = ${patch.reminderLeadMinutes == null ? null : JSON.stringify(patch.reminderLeadMinutes)}`,
    );

  if (sets.length > 0) {
    sets.push(sql`updated_at = ${now}`);
    await db.run(
      sql`UPDATE notification_setting SET ${sql.join(sets, sql`, `)}
          WHERE account_id = ${accountId} AND email_key = ${emailKey}`,
    );
    const updated = await db.get<Record<string, unknown>>(
      sql`SELECT email_key, enabled, subject, body, reminder_lead_minutes, updated_at
          FROM notification_setting
          WHERE account_id = ${accountId} AND email_key = ${emailKey} LIMIT 1`,
    );
    if (updated) return mapRow(updated);

    // No existing row — insert defaults merged with the patch.
    await db.run(
      sql`INSERT INTO notification_setting
            (id, account_id, email_key, enabled, subject, body, reminder_lead_minutes, created_at, updated_at)
          VALUES (${randomUUID()}, ${accountId}, ${emailKey},
            ${patch.enabled === undefined ? 1 : patch.enabled ? 1 : 0},
            ${patch.subject ?? null}, ${patch.body ?? null},
            ${patch.reminderLeadMinutes == null ? null : JSON.stringify(patch.reminderLeadMinutes)},
            ${now}, ${now})`,
    );
  }
  return getNotificationSetting(db, accountId, emailKey);
}

/** "Reset to default": NULL the template override, keep the toggle as-is. */
export async function resetNotificationTemplate(
  db: Db,
  accountId: string,
  emailKey: string,
  now = Date.now(),
): Promise<NotificationSetting> {
  return upsertNotificationSetting(db, accountId, emailKey, { subject: null, body: null }, now);
}
