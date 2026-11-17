---
'@quill/shared': patch
'@quill/types': minor
'@quill/destinations': patch
---

One rule for which spreadsheet columns are in the sheet: a column is written if and only if it has a heading.

- `@quill/types`: a Google Sheets column's `header` may be empty, so a column the author has added but not named yet can be stored. `isWritableSheetColumn` (a heading, nothing else), `writableSheetColumns` and `destinationIsDeliverable` are the one rule every reader uses. A heading with no answer chosen yet is written, with empty cells, which is also what configs with `{header, source: 'answer'}` and no key always meant. Configs stored before this keep parsing unchanged.
- `@quill/destinations`: the Google Sheets adapter writes only the columns that rule names, so a delivered row always lines up with row 1.
- `@quill/shared`: copy for a column with no heading and for one with nothing chosen to fill it, and a short label for the save pill, in English and Spanish.
