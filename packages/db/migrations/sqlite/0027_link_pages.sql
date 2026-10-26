-- Multiple link pages per workspace: additive. See the Postgres twin for the why.
CREATE TABLE IF NOT EXISTS link_page (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL,
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  config      TEXT NOT NULL,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS link_page_account_slug_uq ON link_page (account_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS link_page_account_default_uq ON link_page (account_id) WHERE is_default = 1;

CREATE TABLE IF NOT EXISTS link_page_alias (
  account_id  TEXT NOT NULL,
  slug        TEXT NOT NULL,
  page_id     TEXT NOT NULL REFERENCES link_page(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (account_id, slug)
);
CREATE INDEX IF NOT EXISTS link_page_alias_page_idx ON link_page_alias (page_id);

INSERT INTO link_page (id, account_id, slug, name, config, is_default, created_at, updated_at)
SELECT 'lp-' || a.id, a.id, 'main', '', a.link_page, 1,
       CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM account a
WHERE a.link_page IS NOT NULL
  AND json_valid(a.link_page)
  AND json_type(a.link_page) = 'object'
  AND NOT EXISTS (SELECT 1 FROM link_page p WHERE p.account_id = a.id)
ON CONFLICT DO NOTHING;
