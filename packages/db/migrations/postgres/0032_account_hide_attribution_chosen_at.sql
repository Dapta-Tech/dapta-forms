-- When the workspace last made an EXPLICIT choice on the "Made with dForms"
-- attribution switch (additive + SAFE).
--
--   - account.hide_attribution_chosen_at: epoch ms of the last save through the
--     switch (Brand kit or the design panel), in either direction. NULL = the
--     workspace never chose: `hide_attribution` holds the default (0) or a
--     value dForms wrote on its behalf.
--
-- The referral unlock (ADR 0005) hides the attribution on every workspace its
-- owner holds, but only where the workspace has not chosen yet: a workspace
-- that turned the attribution back on keeps it on. `hide_attribution` is NOT
-- NULL DEFAULT 0 (0028), so "never chose" cannot be read off it, hence this
-- column. Existing rows read NULL: a workspace that saved before today counts
-- as not having chosen; one that hid it already stays hidden either way.
--
-- Migration safety: one nullable ADD COLUMN, no default, no rewrite, no scan.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE account ADD COLUMN IF NOT EXISTS hide_attribution_chosen_at BIGINT;
