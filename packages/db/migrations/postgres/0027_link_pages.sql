-- Multiple link pages per workspace: additive.
--
-- Until now a workspace had exactly one link page, a JSON blob on
-- `account.link_page` (0025), served at /{accountCode}. A workspace can now
-- keep up to 20 (one per trade fair, one for the Instagram bio, one per
-- country...). Each page is a row here with the SAME config blob
-- (`linkPageSchema` in @quill/types, unchanged), a slug unique per workspace
-- and an internal name.
--
-- Exactly one page per workspace is the default: it keeps answering at
-- /{accountCode}; every other page answers at /{accountCode}/p/{slug}. The
-- partial unique index makes "at most one default" a database fact; the
-- repository keeps "at least one while any page exists" (the default page
-- cannot be deleted, only replaced as default by another page).
--
-- `is_default` is an INTEGER 0/1 on both dialects, like every other flag in
-- this schema, so the same statements and the same index predicate run on
-- Postgres and SQLite.
CREATE TABLE IF NOT EXISTS link_page (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL,
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  config      JSONB NOT NULL,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS link_page_account_slug_uq ON link_page (account_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS link_page_account_default_uq ON link_page (account_id) WHERE is_default = 1;

-- A renamed page keeps its old slug here, so a printed QR with the old
-- address 308s to the new one. A slug claimed again by any page of the
-- workspace leaves this ledger (the live page wins), which is what keeps a
-- redirect from ever pointing at itself.
CREATE TABLE IF NOT EXISTS link_page_alias (
  account_id  TEXT NOT NULL,
  slug        TEXT NOT NULL,
  page_id     TEXT NOT NULL REFERENCES link_page(id) ON DELETE CASCADE,
  created_at  BIGINT NOT NULL,
  PRIMARY KEY (account_id, slug)
);
CREATE INDEX IF NOT EXISTS link_page_alias_page_idx ON link_page_alias (page_id);

-- Every existing page becomes its workspace's default page, slug `main`, with
-- the exact same blob: same URL, same content, nothing for anyone to do. The
-- id is derived from the account id, so the copy is deterministic and running
-- it twice copies nothing twice. `account.link_page` is left as it is and is
-- kept in step with the default page by the repository, so it stays a
-- faithful fallback for one release (dropped in a later migration).
INSERT INTO link_page (id, account_id, slug, name, config, is_default, created_at, updated_at)
SELECT 'lp-' || a.id, a.id, 'main', '', a.link_page, 1,
       (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT, (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
FROM account a
WHERE a.link_page IS NOT NULL
  AND jsonb_typeof(a.link_page) = 'object'
  AND NOT EXISTS (SELECT 1 FROM link_page p WHERE p.account_id = a.id)
ON CONFLICT DO NOTHING;
