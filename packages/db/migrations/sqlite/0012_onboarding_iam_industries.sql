-- Onboarding industry values → the Dapta IAM's own bank. Data-only, additive.
--
-- `account.onboarding` used to hold one of eleven buckets Forms invented. It now
-- holds one of the fifty-two `option_value`s from the IAM's `pre_signup` bank,
-- so a Forms account can be segmented with the lead score Dapta already computed
-- for it — the same company was `software` here and `computer_software` there,
-- and no report could span both.
--
-- THIS REWRITE IS NOT OPTIONAL. `accountOnboardingSchema` validates the whole
-- blob with `safeParse`, and `readOnboarding` treats a blob that does not parse
-- as ABSENT. One stale industry value therefore does not lose the industry — it
-- loses `role`, `useCase`, `lastStep`, `stepsSeen` and `startedAt` with it,
-- silently, on every read.
--
-- Nine of the eleven map cleanly. Two do not:
--
--   ecommerce     → retail    The bank has no ecommerce entry; `retail` is the
--                             closest by business, `internet` the closest by
--                             channel. These people sell things; the channel is
--                             the detail.
--   manufacturing → other     The bank has no manufacturing OR logistics entry.
--                             `building_materials`, `chemicals` and
--                             `consumer_goods` are each narrower, so picking one
--                             would invent a specificity nobody stated.
--
-- The column is TEXT here rather than JSONB, so `json_set` does the work — same
-- semantics as the Postgres file's `jsonb_set`, and it likewise preserves every
-- other key. Idempotent: only values that are no longer legal match at all.
UPDATE account
SET onboarding = json_set(
  onboarding,
  '$.industry',
  CASE json_extract(onboarding, '$.industry')
    WHEN 'software'      THEN 'computer_software'
    WHEN 'ecommerce'     THEN 'retail'
    WHEN 'services'      THEN 'consumer_services'
    WHEN 'agency'        THEN 'marketing_advertising'
    WHEN 'health'        THEN 'hospital_healthcare'
    WHEN 'finance'       THEN 'financial_services'
    WHEN 'education'     THEN 'education_management'
    WHEN 'realestate'    THEN 'real_estate'
    WHEN 'manufacturing' THEN 'other'
    ELSE json_extract(onboarding, '$.industry')
  END
)
WHERE onboarding IS NOT NULL
  AND json_extract(onboarding, '$.industry') IN (
    'software', 'ecommerce', 'services', 'agency', 'health',
    'finance', 'education', 'realestate', 'manufacturing'
  );
