-- Form folders: additive.
--
-- A workspace with more than a screenful of forms had one flat list and no
-- way to group it. `form_folder` is that grouping: flat (one level), named
-- only, unique per account without regard to case (the expression index on
-- lower(name)), and a form belongs to at most one (`form.folder_id`, NULL =
-- unfiled, which is what every existing form is). Deleting a folder unfiles
-- its forms (ON DELETE SET NULL, and the repo does it explicitly too) and
-- never deletes them.
CREATE TABLE IF NOT EXISTS form_folder (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS form_folder_account_name_uq ON form_folder (account_id, lower(name));

ALTER TABLE form ADD COLUMN IF NOT EXISTS folder_id TEXT REFERENCES form_folder(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS form_account_folder_idx ON form (account_id, folder_id);
