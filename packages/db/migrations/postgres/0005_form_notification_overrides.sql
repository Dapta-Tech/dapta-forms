-- Per-FORM notification template overrides (Typeform-style Follow-ups) — additive.
--
--   notification_setting.form_id — NULL = the account-level row (existing rows,
--                                   untouched); a form id = an override row for
--                                   that one form. Send-time precedence resolves
--                                   per field: form row → account row → stock.
--
-- Uniqueness mirrors 0001's unique-index approach, split by scope:
--   account rows: (account_id, email_key)          WHERE form_id IS NULL
--   form rows:    (account_id, form_id, email_key) WHERE form_id IS NOT NULL
-- The original notification_setting_account_key_uq (account_id, email_key) must
-- be rebuilt as a partial index in the same script — otherwise the first form
-- row would collide with the account row for the same email_key. No data is
-- touched; the account-scope guard is continuous within this one migration.
ALTER TABLE notification_setting ADD COLUMN form_id TEXT;

DROP INDEX IF EXISTS notification_setting_account_key_uq;
CREATE UNIQUE INDEX IF NOT EXISTS notification_setting_account_key_uq
  ON notification_setting (account_id, email_key) WHERE form_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS notification_setting_account_form_key_uq
  ON notification_setting (account_id, form_id, email_key) WHERE form_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notification_setting_form_idx
  ON notification_setting (form_id) WHERE form_id IS NOT NULL;
