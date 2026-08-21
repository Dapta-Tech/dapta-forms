-- Editable form slugs: additive. See the Postgres twin for the why.
CREATE TABLE IF NOT EXISTS form_alias (
  account_id  TEXT NOT NULL,
  alias       TEXT NOT NULL,
  form_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (account_id, alias)
);

CREATE INDEX IF NOT EXISTS form_alias_form_idx ON form_alias (form_id);
