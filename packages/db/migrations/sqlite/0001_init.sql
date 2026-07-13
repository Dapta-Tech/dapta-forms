-- Dapta Forms — SQLite baseline (portable subset of the Postgres source of truth).
-- Instants are INTEGER epoch-ms; JSON columns are TEXT; booleans are INTEGER 0/1.

CREATE TABLE IF NOT EXISTS account (
  id                      TEXT PRIMARY KEY,
  code                    TEXT NOT NULL UNIQUE,
  name                    TEXT NOT NULL,
  external_id             TEXT UNIQUE,
  vanity_slug             TEXT UNIQUE,
  dapta_entitlement       TEXT,
  entitlement_checked_at  INTEGER,
  created_at              INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS account_alias (
  alias       TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS member (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL,
  external_id   TEXT,
  handle        TEXT,
  display_name  TEXT,
  email         TEXT,
  role          TEXT NOT NULL DEFAULT 'member',
  status        TEXT NOT NULL DEFAULT 'active',
  avatar_url    TEXT,
  locale        TEXT,
  created_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS member_account_external_uq ON member (account_id, external_id);
CREATE INDEX IF NOT EXISTS member_account_idx ON member (account_id);

CREATE TABLE IF NOT EXISTS api_key (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL,
  name            TEXT NOT NULL,
  prefix          TEXT NOT NULL UNIQUE,
  last4           TEXT NOT NULL,
  key_hash        TEXT NOT NULL UNIQUE,
  scopes          TEXT,
  last_used_at_ms INTEGER,
  expires_at_ms   INTEGER,
  revoked_at_ms   INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  action          TEXT NOT NULL,
  subject_uid     TEXT,
  account_id      TEXT,
  webhook_id      TEXT,
  payload         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  next_attempt_at INTEGER NOT NULL,
  last_error      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_due_idx ON outbox (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS notification_setting (
  id                    TEXT PRIMARY KEY,
  account_id            TEXT NOT NULL,
  email_key             TEXT NOT NULL,
  enabled               INTEGER NOT NULL DEFAULT 1,
  subject               TEXT,
  body                  TEXT,
  reminder_lead_minutes TEXT,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_setting_account_key_uq
  ON notification_setting (account_id, email_key);

-- --- Forms domain ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS form (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  config      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS form_account_slug_uq ON form (account_id, slug);

CREATE TABLE IF NOT EXISTS submission (
  id            TEXT PRIMARY KEY,
  form_id       TEXT NOT NULL,
  session_id    TEXT NOT NULL,
  data          TEXT NOT NULL,
  score         INTEGER NOT NULL DEFAULT 0,
  started_at    INTEGER NOT NULL,
  completed_at  INTEGER,
  partial_at    INTEGER
);
-- One persisted submission per (form, session) — the app upserts on this key.
CREATE UNIQUE INDEX IF NOT EXISTS submission_form_session_uq ON submission (form_id, session_id);

CREATE TABLE IF NOT EXISTS form_event (
  id          TEXT PRIMARY KEY,
  form_id     TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  type        TEXT NOT NULL,
  step_index  INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS form_event_form_idx ON form_event (form_id, created_at);
