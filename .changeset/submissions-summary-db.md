---
'@quill/db': minor
---

`searchSubmissionAnswers(db, formId, fields, query)` pages through one
question's answers, newest first, with the total before pagination: a
case-insensitive substring match (accents are not folded), the needle always a
bound parameter, on SQLite and Postgres alike, under the same status and date
filter as the submissions table. `getSubmissionAnswersForAccount` now returns
the whole submission row (id, score, started, completed and partial instants
next to `formId` and `data`), still read through the account join.

`submissionsForSummary(db, formId, filter)` reads every submission matching the
table's filter, newest first, with only the columns the Summary aggregates
(id, answers, started, completed and partial instants).
