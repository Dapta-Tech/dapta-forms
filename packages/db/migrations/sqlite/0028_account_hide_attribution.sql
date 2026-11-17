-- See migrations/postgres/0028_account_hide_attribution.sql for the rationale.
--
-- account.hide_attribution: the workspace's choice, 0 (default, shows) or 1.
-- account.dapta_paid: the cached Dapta AI paid verdict, 1 / 0, NULL = never seen.
-- account.dapta_paid_checked_at: epoch ms that verdict was written.
-- A 0/1 INTEGER is the standing dual-dialect convention for a flag.
ALTER TABLE account ADD COLUMN hide_attribution INTEGER NOT NULL DEFAULT 0;
ALTER TABLE account ADD COLUMN dapta_paid INTEGER;
ALTER TABLE account ADD COLUMN dapta_paid_checked_at INTEGER;
