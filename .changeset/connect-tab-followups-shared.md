---
'@quill/shared': patch
'@quill/types': minor
'@quill/destinations': patch
'@quill/db': patch
---

One rule for which spreadsheet columns are in the sheet: a column is written if and only if it has a heading.

- `@quill/types`: a Google Sheets column's `header` may be empty, so a column the author has added but not named yet can be stored. `isWritableSheetColumn` (a heading, nothing else), `writableSheetColumns` and `destinationIsDeliverable` are the one rule every reader uses. A heading with no answer chosen yet is written, with empty cells, which is also what configs with `{header, source: 'answer'}` and no key always meant. Configs stored before this keep parsing unchanged.
- `@quill/types`: a Sheets destination may also carry `headerForeign`, API-owned bookkeeping for a row 1 it found it may not write, so a failed header sync is retried and a foreign row is not re-read on every save.
- `@quill/db`: `updateFormDestinations` takes an optional `expectedUpdatedAt` for a compare-and-swap write, refused as `STALE` when another write landed since the read. Without it, the write is unchanged.
- `@quill/destinations`: the Google Sheets adapter writes only the columns that rule names, so a delivered row always lines up with row 1.
- `@quill/shared`: copy for a column with no heading and for one with nothing chosen to fill it, for a row 1 that fell out of date, for a sheet with no named column, for a change lost after leaving the tab, and a short label for the save pill, in English and Spanish.
