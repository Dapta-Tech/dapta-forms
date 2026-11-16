---
'@quill/types': patch
'@quill/shared': minor
---

A form's Connect tab can now set up its Google Sheets destination: paste the spreadsheet link, pick the tab from the ones that spreadsheet actually has, and say what each column holds. The column plan starts from the form's own questions, in the form's own order, and a button writes the header row once into an empty first row.

A spreadsheet destination now fires on completed submissions only. A sheet is append-only, so a partial would land as one row from halfway through the form with a fuller row underneath it, and nothing in either saying they are the same person. Every other destination kind is unchanged.
