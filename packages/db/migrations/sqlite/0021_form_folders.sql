-- Form folders: additive. See the Postgres twin for the why.
CREATE TABLE IF NOT EXISTS form_folder (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS form_folder_account_name_uq ON form_folder (account_id, lower(name));

ALTER TABLE form ADD COLUMN folder_id TEXT REFERENCES form_folder(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS form_account_folder_idx ON form (account_id, folder_id);
