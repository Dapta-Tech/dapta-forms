---
'@quill/web': patch
'@quill/api': patch
---

Connect tab follow-ups: nothing the save pill calls saved is lost on a reload.

- A spreadsheet column with only a heading, or only an answer, is saved and comes back after a reload; it goes into the sheet once it is complete, and the row says exactly what it still needs. The API leaves unfinished columns out of the header row and of every delivered row.
- The spreadsheet switch turned on before a sheet is chosen stays on after a reload. Nothing is delivered until a sheet and a complete column exist.
- The editor's topbar no longer says "Saved" while the integrations on the Connect tab failed to save.
- Coming back from Google no longer leaves `?google=connected` behind after connecting Salesforce on the same tab.
- The spreadsheet card checks row 1 once when it opens and shows a mismatch, above the columns, right away.
- The save pill is fixed to the bottom-right corner on phones too, says nothing until the first save, and settles into a short, flat "Saved" that does not block taps.
