-- See migrations/postgres/0032_account_hide_attribution_chosen_at.sql for the rationale.
--
-- account.hide_attribution_chosen_at: epoch ms of the workspace's last explicit
-- choice on the attribution switch; NULL = it never chose.
ALTER TABLE account ADD COLUMN hide_attribution_chosen_at INTEGER;
