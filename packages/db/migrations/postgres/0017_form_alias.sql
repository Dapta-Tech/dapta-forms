-- Editable form slugs: additive.
--
-- `form.slug` is the third segment of a form's public URL
-- (/{accountCode}/{handle}/{slug}). Until now it was written once, derived from
-- the form's name at creation, and there was no way to change it. Making it
-- editable means a published URL can stop being the current one, so every value
-- a slug has ever had is retired into this ledger rather than dropped:
--
--   form_alias  — a slug this form used to answer to. The public resolver falls
--                 back to it when no form matches the requested slug directly,
--                 and the page 308s to the canonical URL. A QR code on a
--                 printed flyer, a campaign link in an email already sent, an
--                 iframe embed pasted into someone else's site and a HubSpot
--                 property holding the old URL all keep working.
--
-- Keyed by (account_id, alias) rather than by alias alone. That is the one
-- structural difference from `account_alias`, and it follows from
-- `form_account_slug_uq`: a form slug is unique within its ACCOUNT, not
-- globally, so two accounts may each retire a slug called `contact`.
CREATE TABLE IF NOT EXISTS form_alias (
  account_id  TEXT NOT NULL,
  alias       TEXT NOT NULL,
  form_id     TEXT NOT NULL,
  created_at  BIGINT NOT NULL,
  PRIMARY KEY (account_id, alias)
);

-- Deleting a form drops its aliases, which is a lookup by form_id and not by
-- the primary key. Without this it is a full scan on every form deletion.
CREATE INDEX IF NOT EXISTS form_alias_form_idx ON form_alias (form_id);
