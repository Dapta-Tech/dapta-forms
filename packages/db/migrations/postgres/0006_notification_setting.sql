-- Additive (SAFE): per-account notification controls. One row per
-- (account, email_key) — absent row = shipped default (enabled, stock
-- template), so existing accounts and forks change nothing. `subject`/`body`
-- NULL = use the shipped default template; `reminder_lead_minutes` is a JSON
-- array of minutes-before-start, only meaningful on the reminder key.
--
-- Pure additive DDL: a new table, no rewrite of existing data.

CREATE TABLE IF NOT EXISTS notification_setting (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  email_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  subject TEXT,
  body TEXT,
  reminder_lead_minutes TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_setting_account_key
  ON notification_setting (account_id, email_key);
