---
'@quill/web': patch
'@quill/api': patch
---

Connect tab follow-ups: nothing the save pill calls saved is lost on a reload.

- Every spreadsheet column is saved and comes back after a reload. A column with a heading is in the sheet (with empty cells until an answer is chosen); one without a heading is not, and has no letter on the card. The card's letters, row 1 and every delivered row always agree.
- The spreadsheet switch turned on before a sheet is chosen stays on after a reload. Nothing is delivered until a sheet and a complete column exist.
- The editor's topbar no longer says "Saved" while the integrations on the Connect tab failed to save, and it ends on the right state when the tab is left before a save runs.
- Coming back from Google no longer leaves `?google=connected` behind after connecting Salesforce on the same tab.
- The spreadsheet card looks at row 1 once when it opens and shows a mismatch, above the columns, right away. The look writes nothing, so an edit made while Google is slow cannot be undone by it.
- The save pill is fixed to the bottom-right corner on phones too, says nothing until the first save, and settles into a short, flat "Saved" that does not block taps.
- A header-row sync that failed (Google down while columns were reordered) is retried by the next save instead of being skipped, and a row 1 that fell out of date is shown with a one-press update.
- A change whose save fails after the tab is left is retried a few times, then reported as not saved, once, when the author comes back; the topbar never stays on a promise of another try.
