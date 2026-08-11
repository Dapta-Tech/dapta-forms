-- Onboarding industry values → the Dapta IAM's own bank. Data-only, additive.
--
-- `account.onboarding.industry` used to hold one of eleven buckets Forms
-- invented. It now holds one of the fifty-two `option_value`s from the IAM's
-- `pre_signup` question bank, so a Forms account can be segmented with the lead
-- score Dapta already computed for it — the same company was `software` here
-- and `computer_software` there, and no report could span both.
--
-- THIS REWRITE IS NOT OPTIONAL. `accountOnboardingSchema` validates the whole
-- blob with `safeParse`, and `readOnboarding` treats a blob that does not parse
-- as ABSENT. One stale industry value therefore does not lose the industry — it
-- loses `role`, `useCase`, `lastStep`, `stepsSeen` and `startedAt` along with it,
-- silently, on every read. Left unmigrated, every account onboarded before this
-- release would read as though it had never opened the wizard.
--
-- Nine of the eleven map cleanly. Two do not, and are recorded here rather than
-- guessed at again later:
--
--   ecommerce     → retail        The bank has no ecommerce entry. `retail` is
--                                 the closest by business, `internet` the
--                                 closest by channel; retail wins because these
--                                 people sell things, and the channel is the
--                                 detail.
--   manufacturing → other         The bank has no manufacturing OR logistics
--                                 entry at all. `building_materials`,
--                                 `chemicals` and `consumer_goods` are each a
--                                 narrower thing, so any of them would be a
--                                 fabricated specificity. `other` is the honest
--                                 answer, and `sources` will not claim these
--                                 were asked.
--
-- Idempotent: it only matches values that are no longer legal, so a re-run is a
-- no-op. Postgres jsonb is written back with `jsonb_set`, which preserves every
-- other key in the blob.
UPDATE account
SET onboarding = jsonb_set(
  onboarding,
  '{industry}',
  to_jsonb(
    CASE onboarding->>'industry'
      WHEN 'software'      THEN 'computer_software'
      WHEN 'ecommerce'     THEN 'retail'
      WHEN 'services'      THEN 'consumer_services'
      WHEN 'agency'        THEN 'marketing_advertising'
      WHEN 'health'        THEN 'hospital_healthcare'
      WHEN 'finance'       THEN 'financial_services'
      WHEN 'education'     THEN 'education_management'
      WHEN 'realestate'    THEN 'real_estate'
      WHEN 'manufacturing' THEN 'other'
      WHEN 'nonprofit'     THEN 'nonprofit'
      ELSE onboarding->>'industry'
    END
  )
)
WHERE onboarding IS NOT NULL
  AND onboarding->>'industry' IN (
    'software', 'ecommerce', 'services', 'agency', 'health',
    'finance', 'education', 'realestate', 'manufacturing'
  );
