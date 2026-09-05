-- The owner notice gained an `{{answers}}` token (the submission's answers as
-- "Label: value" lines / a table), and the shipped default now carries it.
-- An account or form that customized its owner-notice body BEFORE the token
-- existed would otherwise keep receiving an email without the answers, which
-- is the exact bug this release fixes. Append the token to every custom body
-- that lacks it (with a blank spacer line, matching the default's layout).
-- NULL bodies render the shipped default and need nothing. The respondent
-- email is untouched: the answers there are opt-in. Reruns match nothing.
UPDATE notification_setting
SET body = body || char(10) || char(10) || '{{answers}}'
WHERE email_key = 'submission_received'
  AND body IS NOT NULL
  AND body NOT LIKE '%{{answers}}%'
  AND body NOT LIKE '%{{ answers }}%';
