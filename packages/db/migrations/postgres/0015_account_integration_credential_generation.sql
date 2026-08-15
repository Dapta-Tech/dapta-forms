-- Durable, database-allocated revision for account integration credentials.
-- PostgreSQL 16 applies a constant DEFAULT without a per-row table rewrite.
ALTER TABLE account_integration
  ADD COLUMN credential_generation BIGINT NOT NULL DEFAULT 1;
