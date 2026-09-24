---
'@quill/db': minor
---

One `SubmissionFilter` for the submissions table, its CSV export, the Summary
and its answer search: status, a `started_at` window, inclusive score bounds
(`scoreMin`, `scoreMax`, rounded inward to whole numbers and held to int32, so
`5.5` or `1e20` narrows instead of failing the query on Postgres) and answer
filters (`answers`, question key to the
values accepted). Within one key any value matches, and a multi-select matches
when any of its picks is accepted; across keys every one must match. The
answers are read from the stored JSON on both dialects (Postgres `jsonb_each`,
SQLite `json_each`, the key compared as a value so any key matches the same on
both), a single stored value and an array alike, trimmed the way
the Summary counts them, with the key and every value as bound parameters.
Callers must check the keys against the form's own choice steps first.

`querySubmissions` and `allSubmissionsForExport` take a `sort` (`newest`,
`oldest`, `score_desc`, `score_asc`), every order ending on the id so a page
boundary never shuffles ties. `SUBMISSION_SORTS` lists them.

`submissionFacetCounts(db, formId, keys)` counts what the header filters offer
in the database: the total, completed and partial, and per question key how
many responses answered it and how many picked each trimmed value. Only counts
leave the database, however many responses a form has.
