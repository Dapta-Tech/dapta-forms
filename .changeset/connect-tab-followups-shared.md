---
'@quill/shared': patch
'@quill/types': minor
---

Spreadsheet columns and switches the author has started are kept.

- `@quill/types`: a Google Sheets column's `header` may be empty, so a column the author is still filling in can be stored. New helpers `isWritableSheetColumn`, `writableSheetColumns` and `destinationIsDeliverable` say which columns go into the sheet and whether a stored destination can deliver at all. Configs stored before this keep parsing unchanged.
- `@quill/shared`: copy for what an unfinished column still needs, for columns that are saved but not in the sheet yet, and a short label for the save pill, in English and Spanish.
