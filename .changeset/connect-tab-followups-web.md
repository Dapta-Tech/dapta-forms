---
'@quill/web': patch
---

Connect tab follow-ups.

- Coming back from Google no longer leaves `?google=connected` behind: connecting Salesforce on the same tab used to restore it, so a reload announced the connection again and reopened the spreadsheet card.
- The spreadsheet card looks at row 1 once when it opens, so a sheet whose headings do not match shows the comparison and "Replace row 1" right away.
- The save pill is fixed to the bottom-right corner on phones too, says nothing until the first save, and folds to its green check a moment after saving.
- A column still being filled in is named as not in the sheet yet, instead of the card saying row 1 matches.
