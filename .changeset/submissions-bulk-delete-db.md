---
'@quill/db': minor
---

Submissions: `deleteSubmissionsForAccount` deletes a selection of one form's submissions in a single statement, scoped to the account like the single delete (a foreign id is never touched), at most `MAX_BULK_SUBMISSIONS` (100) ids. `allSubmissionsForExport` takes an optional `ids` list so a CSV can carry only the selected rows.
