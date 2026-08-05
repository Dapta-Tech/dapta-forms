-- Product analytics groundwork — additive.
--
-- Five nullable columns that let the product answer questions the schema could
-- not answer before. No table is rewritten and no existing row is touched: every
-- column starts NULL and NULL is a meaningful "not known", never a default that
-- misreports history.
--
--   account.attribution   — RESERVED; nothing writes it yet. Will hold the
--                           first-touch acquisition context (utm_*, referrer,
--                           landing_path, first_seen_at) captured in the browser
--                           on the first visit and sent with signup, so
--                           attribution survives a cookie wipe and can be joined
--                           in SQL. The shape is `attributionSchema` in
--                           @quill/types; the writer lands with the signup form.
--
--   account.activated_at    — epoch-ms the account's first completed submission
--   account.first_viewed_at   arrived / its first form was viewed. These are
--                           MILESTONE CLAIMS, not descriptive timestamps: the
--                           write is `UPDATE … WHERE <col> IS NULL`, so exactly
--                           one caller can ever win, and the analytics event is
--                           emitted only by that winner.
--
--                           A read-then-act check ("does an earlier completed
--                           submission exist?") cannot do this. Two answers that
--                           commit at the same instant each see the other and
--                           BOTH decline — the account then has completions
--                           forever, so every later check also declines and it
--                           can never activate. The same shape double-fires on a
--                           re-submitted session, because the row excludes
--                           itself from its own check. Both were reproduced.
--
--   form.created_by       — member.id of whoever created the form; NULL for forms
--                           created before this shipped, and for any path that
--                           creates a form without a member principal (API key).
--                           Deliberately NOT a foreign key: the platform tables
--                           carry no FK constraints, and a deleted member must not
--                           cascade into deleting someone's form. Ownership of a
--                           form stays with account_id — this column is authorship,
--                           for per-user analytics, never for authorization.
--
--   member.last_seen_at   — epoch-ms of the member's most recent authenticated
--                           request. NULL = never seen since this shipped. Turns
--                           "N members exist" into "N exist, M came back", which
--                           member.created_at alone cannot express.
--
-- SQLite has no ADD COLUMN IF NOT EXISTS. It does not need one: migrate.ts runs
-- each numbered file exactly once, gated on the _migrations table, so a bare
-- ADD COLUMN is applied a single time per database — the same contract every
-- prior SQLite migration here relies on (see 0009).
ALTER TABLE account ADD COLUMN attribution TEXT;
ALTER TABLE account ADD COLUMN activated_at INTEGER;
ALTER TABLE account ADD COLUMN first_viewed_at INTEGER;
ALTER TABLE form ADD COLUMN created_by TEXT;
ALTER TABLE member ADD COLUMN last_seen_at INTEGER;

-- Backfill the two claims from history, so a milestone that ALREADY happened is
-- not re-claimed — and therefore not re-announced — the next time it recurs.
-- Without this, every existing account with answers would emit an `activation`
-- on its next submission, months after it actually activated, and the launch
-- numbers would open with a wave of false conversions.
--
-- Idempotent (`WHERE … IS NULL`) and portable: a correlated subquery is the one
-- shape both dialects agree on. NULL stays NULL for an account the milestone
-- never reached, which is exactly what lets it be claimed for real later.
UPDATE account SET activated_at = (
  SELECT MIN(s.completed_at) FROM submission s JOIN form f ON f.id = s.form_id
  WHERE f.account_id = account.id AND s.completed_at IS NOT NULL
) WHERE activated_at IS NULL;

UPDATE account SET first_viewed_at = (
  SELECT MIN(e.created_at) FROM form_event e JOIN form f ON f.id = e.form_id
  WHERE f.account_id = account.id AND e.type = 'view'
) WHERE first_viewed_at IS NULL;
