-- Onboarding wizard — additive.
--
-- Two nullable columns on `account`. Together they answer "who is this workspace
-- for, and did they ever finish setting it up" — the two questions the schema
-- could not answer before, and the ones every drop-off report needs.
--
--   account.onboarding             — JSON, the wizard's working state AND its
--                                    result. Shape is `accountOnboardingSchema`
--                                    in @quill/types:
--                                      { version, role, industry, useCase,
--                                        template, lastStep, stepsSeen[],
--                                        startedAt }
--                                    Written on EVERY step advance, not only at
--                                    the end — that is the whole point. A row
--                                    with `lastStep: 'industry'` and no
--                                    `onboarding_completed_at` IS the drop-off
--                                    record; without the incremental write, an
--                                    abandoned onboarding leaves nothing behind
--                                    and "where do people quit" is unanswerable.
--
--                                    Joins to `account.attribution` (0010) on
--                                    the same row, so drop-off per campaign is
--                                    one GROUP BY with no new plumbing.
--
--   account.onboarding_completed_at — epoch-ms the wizard was finished. A
--                                    MILESTONE CLAIM in the 0010 sense: written
--                                    `UPDATE … WHERE … IS NULL`, so exactly one
--                                    caller wins and the completion event fires
--                                    once. Also the gate the dashboard reads —
--                                    NULL means "send them to the wizard".
ALTER TABLE account ADD COLUMN IF NOT EXISTS onboarding JSONB;
ALTER TABLE account ADD COLUMN IF NOT EXISTS onboarding_completed_at BIGINT;

-- Every account that already exists predates the wizard, so it is onboarded BY
-- DEFINITION. Without this, the gate reads NULL for all of them and every
-- existing user is bounced out of their dashboard into a wizard they never
-- asked for, on the first request after this migration runs.
--
-- `created_at` rather than `now()`: it keeps "completed before we shipped this"
-- legible in the data instead of stamping the whole table with the deploy
-- timestamp and inventing a spike of completions that never happened.
--
-- Idempotent (`WHERE … IS NULL`), so it is a no-op for any row a later claim
-- has already won.
UPDATE account SET onboarding_completed_at = created_at
WHERE onboarding_completed_at IS NULL;

-- The funnel query filters on this column ("accounts created since X that have
-- NOT completed"), which is a scan without it.
CREATE INDEX IF NOT EXISTS account_onboarding_completed_idx
  ON account (onboarding_completed_at);
