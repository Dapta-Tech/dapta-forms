---
'@quill/types': minor
'@quill/destinations': patch
'@quill/shared': patch
---

A spreadsheet column whose heading is cleared keeps its place in the sheet.

- New `sheetCells(columns, written)` and `writtenSheetHeaders(destination)` in `@quill/types`. A column with no heading still stays out of the sheet, unless dForms already wrote a heading at its position: then the position is held (row 1 keeps the old heading, the cell is delivered empty) until the column is named again or deleted. Renaming a middle column no longer moves the columns after it one cell to the left while the new name is being typed.
- The Google Sheets adapter takes the row 1 dForms last wrote (`writtenHeaders`) and builds each delivered row from the same cells.
- New catalog strings for the held column's note and the dismiss button of the "your last change was not saved" notice, in English and Spanish.
