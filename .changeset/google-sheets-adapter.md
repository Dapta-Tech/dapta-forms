---
'@quill/types': minor
'@quill/destinations': minor
---

A form can now append every submission to a Google Sheet as a new row.

The destination stores the spreadsheet, the tab and an ordered list of columns. Columns are a list rather than a map because a spreadsheet's columns are ordered, and they are never derived from a submission's own answers: two respondents answer different optional questions, so a row built from whichever one arrived would put the same question in a different column on every line.

One API call per delivery. Google's write quota is 60 requests a minute per user, and a submission burst is exactly when a form is worth the most, so the adapter does not read the sheet, look up the tab or write a header row: those are one-time jobs for the admin surface, not per-respondent work.

Values are written raw, so an answer that begins with `=` stays text instead of becoming a formula in someone else's spreadsheet.

A delivery that cannot succeed however often it is retried (a deleted spreadsheet, a renamed tab, access revoked) is reported as a no-op naming the cause, and only quota, server errors and transport failures are retried.
