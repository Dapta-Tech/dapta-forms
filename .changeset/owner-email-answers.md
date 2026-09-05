---
'@quill/engine': minor
'@quill/notifications': minor
'@quill/db': patch
'@quill/shared': patch
---

The owner notice now carries the answers, a working submissions link and a real HTML body.

Until now the "new submission" email told the owner that someone answered and
nothing else: the answers were never passed to the template, the
`{{formLink}}` token had no producer (so the "View submissions" line always
dropped out and custom templates looked half rendered), and the HTML body was
a bare `<p>` with `<br/>` separators, which most clients showed as plain text.

- `summarizeAnswers(config, answers)` in the engine resolves a submission to
  `{label, value}` rows in step order: the question the respondent actually
  saw, option values mapped back to their labels, multi-selects joined with
  commas, bookings as `YYYY-MM-DD HH:mm UTC`, values capped at 2000 characters.
- New `{{answers}}` token, available in both submission emails and included
  by default in the owner notice only (blank line, the answers, blank line,
  then the link). In text it renders one `Label: value` line per answer; in
  HTML a two-column table with every cell escaped.
- `{{formLink}}` now points the owner at `PUBLIC_APP_URL/admin/forms/:id/submissions`
  (absent in a bare fork without `PUBLIC_APP_URL`; never on the respondent receipt).
- Every email is a complete responsive HTML document (doctype, viewport,
  600px card, system font stack, real `</body></html>` so the transactional
  service can splice its footer). Stock and custom bodies follow one rule: a
  line is dropped only when it has tokens and all of them resolved empty, so
  blank spacer lines and sign-offs survive. Runs of blank lines left behind by
  dropped lines collapse to one, and leading or trailing blank lines are
  trimmed.
- Migration 0019 appends `{{answers}}` to every custom owner-notice body that
  lacks it (account and per-form rows), so templates edited before the token
  existed also get the answers. Idempotent.
- An owner without an email no longer enqueues a row that fails five times;
  rows already queued with no recipient are skipped once instead of retried.
- Settings and the Connect tab show an "Answers" variable chip and a permanent
  notice on the owner notice when its body lacks `{{answers}}`; the preview
  sample shows the answers block. The respondent card no longer offers the
  `{{formLink}}` chip, which that email never produces. The chip label reads
  "Submissions link".
- i18n: `admin.notifications.tokenAnswers`, `answersMissing` (EN + ES).
