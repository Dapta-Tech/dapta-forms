---
'@quill/engine': patch
---

Submissions table and CSV: the Name question shows the answer.

A `name` step stores its answer as flat `firstname`/`lastname` entries and
never under its own key. The submissions table and the CSV export read every
column as `data[step.key]`, so the Name column was blank for every form with a
name question, since the first release, on every account. The notification
email was never affected: it already joined the sub-fields.

The engine now exposes `nameAnswer(step, answers)` ("First Last", empty when
unanswered) and the email summary, the table cell (and its hover title) and the
CSV column all read through it. No data changes: existing rows already carry
the sub-fields, so old submissions show their names right away.
