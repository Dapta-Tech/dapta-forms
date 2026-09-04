-- Workspace timezone: additive.
--
-- Every date the admin shows was rendered on the server clock (UTC) and the
-- analytics day buckets were UTC days, so a team in Bogota read yesterday's
-- evening submissions as today's. `account.timezone` is the IANA zone the
-- whole workspace reads dates in: the submissions table, the analytics day
-- cuts and the CSV's local columns. NULL means UTC, exactly as before, until
-- the first admin's browser claims it (UPDATE ... WHERE timezone IS NULL).
ALTER TABLE account ADD COLUMN IF NOT EXISTS timezone TEXT;
