-- Durable, database-allocated revision for account integration credentials.
-- SQLite serves DEFAULT 1 for existing rows without rewriting each row.
ALTER TABLE account_integration
  ADD COLUMN credential_generation INTEGER NOT NULL DEFAULT 1;
