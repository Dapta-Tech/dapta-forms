-- Repair the accounts that parked THEMSELVES.
--
-- The IAM hands some personal workspaces an id equal to their account id, so
-- `rebindLegacyAccount`'s two lookups (legacy row by upstream ACCOUNT id,
-- projected row by upstream WORKSPACE id) resolved to the SAME row. On the
-- owner's second session that row parked itself (`external_id` prefixed with
-- `legacy:`, members disabled) and the projection then recreated the workspace
-- as a fresh, empty account — stranding the person's forms in a row nothing
-- can reach. The code guard shipped alongside this migration stops new
-- self-parks; this script moves the stranded forms into the live twin.
--
-- The pair signature is exact, and it is what keeps the legitimate pre-0015
-- parks out of scope: those live rows carry a WORKSPACE id different from
-- `iam_account_id`, while a self-parked pair's live row has the two equal.
--
--   parked.external_id = 'legacy:' || live.external_id
--   live.external_id   = live.iam_account_id
--
-- The parked account and its disabled member rows STAY (this repo never
-- deletes them — `created_by` on the moved forms keeps resolving), and the
-- parked row's public code is retired into `account_alias` so any URL shared
-- while the forms lived there still finds them. Every statement stops
-- matching after the first run, so a rerun is a no-op.

-- 1. A moved form's slug may already exist in the live twin (the owner
--    recreated it from the same template). Slugs are unique per account, so
--    suffix the parked copy with a fragment of its id before the move.
UPDATE form SET slug = slug || '-' || substr(form.id, 1, 8)
WHERE EXISTS (
  SELECT 1 FROM account parked
  JOIN account live
    ON parked.external_id = 'legacy:' || live.external_id
   AND live.external_id = live.iam_account_id
  WHERE parked.id = form.account_id
    AND EXISTS (SELECT 1 FROM form lf WHERE lf.account_id = live.id AND lf.slug = form.slug)
);

-- 2. Retired slugs follow their forms — but only where the live twin has not
--    retired the same alias itself ((account_id, alias) is the primary key).
--    A row that would collide stays behind on the parked account, dead but
--    harmless.
UPDATE form_alias SET account_id = (
  SELECT live.id FROM account parked
  JOIN account live
    ON parked.external_id = 'legacy:' || live.external_id
   AND live.external_id = live.iam_account_id
  WHERE parked.id = form_alias.account_id
)
WHERE EXISTS (
  SELECT 1 FROM account parked
  JOIN account live
    ON parked.external_id = 'legacy:' || live.external_id
   AND live.external_id = live.iam_account_id
  WHERE parked.id = form_alias.account_id
    AND NOT EXISTS (SELECT 1 FROM form_alias fa WHERE fa.account_id = live.id AND fa.alias = form_alias.alias)
);

-- 3. The move itself. submission, form_event and the webhook ledger hang off
--    form_id and follow on their own.
UPDATE form SET account_id = (
  SELECT live.id FROM account parked
  JOIN account live
    ON parked.external_id = 'legacy:' || live.external_id
   AND live.external_id = live.iam_account_id
  WHERE parked.id = form.account_id
)
WHERE EXISTS (
  SELECT 1 FROM account parked
  JOIN account live
    ON parked.external_id = 'legacy:' || live.external_id
   AND live.external_id = live.iam_account_id
  WHERE parked.id = form.account_id
);

-- 4. Retire the parked row's public codes onto the live twin, so
--    /{parkedCode}/{handle}/{slug} keeps resolving (the resolver falls back to
--    account_alias, and the handle segment never gates). The fixed timestamp
--    is this migration's authoring date.
INSERT INTO account_alias (alias, account_id, created_at)
SELECT parked.code, live.id, 1756684800000
FROM account parked
JOIN account live
  ON parked.external_id = 'legacy:' || live.external_id
 AND live.external_id = live.iam_account_id
ON CONFLICT DO NOTHING;

INSERT INTO account_alias (alias, account_id, created_at)
SELECT parked.vanity_slug, live.id, 1756684800000
FROM account parked
JOIN account live
  ON parked.external_id = 'legacy:' || live.external_id
 AND live.external_id = live.iam_account_id
WHERE parked.vanity_slug IS NOT NULL
ON CONFLICT DO NOTHING;
