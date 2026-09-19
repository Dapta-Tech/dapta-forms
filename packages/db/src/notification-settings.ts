/**
 * NOTIFICATION SETTINGS — the storage behind Settings → Notifications (per-key
 * toggle + template controls) and the per-form template overrides on the
 * editor's Connect tab. One row per (account, email_key) SCOPE:
 *
 *   form_id NULL   — the ACCOUNT-level row (the default for every helper here;
 *                    existing call sites read/write exactly what they always did)
 *   form_id set    — a PER-FORM override row for that one form
 *
 * An ABSENT row means "inherit": for the account scope that is "shipped
 * default" (enabled, stock template); for the form scope it is "use the account
 * setting". `subject`/`body` NULL = inherit that FIELD from the next layer
 * (account row, then the stock template) — so "reset to default" is just
 * NULLing them, and send-time precedence is form → account → stock per field.
 * `recipients` follows the same per-FIELD chain: NULL = inherit, while an EMPTY
 * array is a deliberate "this scope notifies the owner only" that stops the
 * inheritance. Stored as JSON inside TEXT, like `reminder_lead_minutes`.
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
  /** NULL = the account-level row; a form id = a per-form override row. */
  formId: string | null;
  enabled: boolean;
  /** NULL = shipped default template (account rows) / inherit (form rows). */
  subject: string | null;
  body: string | null;
  /** Minutes before start, ascending not required; NULL = shipped default leads. */
  reminderLeadMinutes: number[] | null;
  /** Who the notice goes to. NULL = inherit; [] = the owner only. */
  recipients: string[] | null;
  updatedAt: number | null;
}

export interface NotificationSettingPatch {
  enabled?: boolean;
  /** NULL resets to the shipped default; undefined leaves untouched. */
  subject?: string | null;
  body?: string | null;
  reminderLeadMinutes?: number[] | null;
  /** NULL restores inheritance; [] pins "the owner only"; undefined leaves it. */
  recipients?: string[] | null;
}

/** A safe default when no row exists (fork/default behavior: everything ON). */
export function defaultNotificationSetting(emailKey: string): NotificationSetting {
  return {
    emailKey,
    formId: null,
    enabled: true,
    subject: null,
    body: null,
    reminderLeadMinutes: null,
    recipients: null,
    updatedAt: null,
  };
}

/** The row-scope filter: null/undefined = the account row, a form id = that form's row. */
function scopeFilter(formId?: string | null) {
  return formId == null ? sql`form_id IS NULL` : sql`form_id = ${formId}`;
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

/**
 * Unlike `parseLeads`, an empty array is KEPT: for recipients it is a stored
 * decision ("the owner only"), not an absent override, and collapsing it to
 * NULL would silently turn it back into "inherit".
 */
function parseRecipients(raw: unknown): string[] | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return null;
    return arr
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim());
  } catch {
    return null;
  }
}

function mapRow(r: Record<string, unknown>): NotificationSetting {
  return {
    emailKey: String(r.email_key),
    formId: (r.form_id as string | null) ?? null,
    enabled: Number(r.enabled) !== 0,
    subject: (r.subject as string | null) ?? null,
    body: (r.body as string | null) ?? null,
    reminderLeadMinutes: parseLeads(r.reminder_lead_minutes),
    recipients: parseRecipients(r.recipients),
    updatedAt: r.updated_at == null ? null : Number(r.updated_at),
  };
}

/**
 * All stored settings for ONE scope of an account, keyed by email_key (absent =
 * inherit). Default scope (no formId) = the account-level rows — existing call
 * sites keep their exact behavior; pass a formId for that form's override rows.
 */
export async function getNotificationSettings(
  db: Db,
  accountId: string,
  formId?: string | null,
): Promise<Map<string, NotificationSetting>> {
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT email_key, form_id, enabled, subject, body, reminder_lead_minutes, recipients, updated_at
        FROM notification_setting
        WHERE account_id = ${accountId} AND ${scopeFilter(formId)}`,
  );
  return new Map(rows.map((r) => [String(r.email_key), mapRow(r)]));
}

/** One setting (in one scope) with the default fallback — never null. */
export async function getNotificationSetting(
  db: Db,
  accountId: string,
  emailKey: string,
  formId?: string | null,
): Promise<NotificationSetting> {
  const row = await db.get<Record<string, unknown>>(
    sql`SELECT email_key, form_id, enabled, subject, body, reminder_lead_minutes, recipients, updated_at
        FROM notification_setting
        WHERE account_id = ${accountId} AND email_key = ${emailKey} AND ${scopeFilter(formId)}
        LIMIT 1`,
  );
  return row ? mapRow(row) : defaultNotificationSetting(emailKey);
}

/**
 * Create-or-update the (account, email_key) row of ONE scope applying only the
 * fields present in the patch. Default scope = the account row; pass a formId
 * to address that form's override row. Portable upsert: UPDATE first, INSERT
 * (merged with defaults) when nothing matched — single-process semantics are
 * fine on both engines here (settings writes come from one admin screen, not a
 * hot path).
 */
export async function upsertNotificationSetting(
  db: Db,
  accountId: string,
  emailKey: string,
  patch: NotificationSettingPatch,
  now = Date.now(),
  formId: string | null = null,
): Promise<NotificationSetting> {
  const sets = [];
  if (patch.enabled !== undefined) sets.push(sql`enabled = ${patch.enabled ? 1 : 0}`);
  if (patch.subject !== undefined) sets.push(sql`subject = ${patch.subject}`);
  if (patch.body !== undefined) sets.push(sql`body = ${patch.body}`);
  if (patch.reminderLeadMinutes !== undefined)
    sets.push(
      sql`reminder_lead_minutes = ${patch.reminderLeadMinutes == null ? null : JSON.stringify(patch.reminderLeadMinutes)}`,
    );
  if (patch.recipients !== undefined)
    sets.push(sql`recipients = ${patch.recipients == null ? null : JSON.stringify(patch.recipients)}`);

  if (sets.length > 0) {
    sets.push(sql`updated_at = ${now}`);
    await db.run(
      sql`UPDATE notification_setting SET ${sql.join(sets, sql`, `)}
          WHERE account_id = ${accountId} AND email_key = ${emailKey} AND ${scopeFilter(formId)}`,
    );
    const updated = await db.get<Record<string, unknown>>(
      sql`SELECT email_key, form_id, enabled, subject, body, reminder_lead_minutes, recipients, updated_at
          FROM notification_setting
          WHERE account_id = ${accountId} AND email_key = ${emailKey} AND ${scopeFilter(formId)}
          LIMIT 1`,
    );
    if (updated) return mapRow(updated);

    // No existing row — insert defaults merged with the patch.
    await db.run(
      sql`INSERT INTO notification_setting
            (id, account_id, email_key, form_id, enabled, subject, body, reminder_lead_minutes, recipients, created_at, updated_at)
          VALUES (${randomUUID()}, ${accountId}, ${emailKey}, ${formId ?? null},
            ${patch.enabled === undefined ? 1 : patch.enabled ? 1 : 0},
            ${patch.subject ?? null}, ${patch.body ?? null},
            ${patch.reminderLeadMinutes == null ? null : JSON.stringify(patch.reminderLeadMinutes)},
            ${patch.recipients == null ? null : JSON.stringify(patch.recipients)},
            ${now}, ${now})`,
    );
  }
  return getNotificationSetting(db, accountId, emailKey, formId);
}

/** "Reset to default": NULL the template override, keep the toggle as-is. */
export async function resetNotificationTemplate(
  db: Db,
  accountId: string,
  emailKey: string,
  now = Date.now(),
  formId: string | null = null,
): Promise<NotificationSetting> {
  return upsertNotificationSetting(db, accountId, emailKey, { subject: null, body: null }, now, formId);
}

/**
 * Remove a FORM's override row entirely so the form fully inherits the account
 * setting again (template AND toggle). Form scope only — the account-level row
 * is never deleted (its "reset" is resetNotificationTemplate, which keeps the
 * toggle). Idempotent: deleting an absent row is a no-op.
 */
export async function deleteNotificationSetting(
  db: Db,
  accountId: string,
  emailKey: string,
  formId: string,
): Promise<void> {
  await db.run(
    sql`DELETE FROM notification_setting
        WHERE account_id = ${accountId} AND email_key = ${emailKey} AND form_id = ${formId}`,
  );
}
