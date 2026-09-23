---
'@quill/db': minor
---

One `SubmissionFilter` for the submissions table, its CSV export, the Summary
and its answer search: status, a `started_at` window, inclusive score bounds
(`scoreMin`, `scoreMax`) and answer filters (`answers`, question key to the
values accepted). Within one key any value matches, and a multi-select matches
when any of its picks is accepted; across keys every one must match. The
answers are read from the stored JSON on both dialects (Postgres `jsonb`,
SQLite `json_each`), a single stored value and an array alike, trimmed the way
the Summary counts them, with the key and every value as bound parameters.
Callers must check the keys against the form's own choice steps first.

`querySubmissions` and `allSubmissionsForExport` take a `sort` (`newest`,
`oldest`, `score_desc`, `score_asc`), every order ending on the id so a page
boundary never shuffles ties. `SUBMISSION_SORTS` lists them.
