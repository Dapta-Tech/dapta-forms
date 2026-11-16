---
'@quill/types': patch
'@quill/shared': minor
---

A form's Connect tab can now set up its Google Sheets destination: create a spreadsheet for the form in one click (named after the form, with its header row already written), or choose one you already have in Google Drive, then pick the tab and say what each column holds. The column plan starts from the form's own questions, in the form's own order.

There is no field to paste a spreadsheet link into, on purpose. The app asks Google only for access to the files it creates and the ones you choose, so a pasted link to any other spreadsheet could not be opened.

A spreadsheet destination now fires on completed submissions only. A sheet is append-only, so a partial would land as one row from halfway through the form with a fuller row underneath it, and nothing in either saying they are the same person. Every other destination kind is unchanged.
