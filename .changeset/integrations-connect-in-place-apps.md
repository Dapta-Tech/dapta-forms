---
'@quill/web': minor
'@quill/api': minor
---

The Connect tab connects accounts in place, and the spreadsheet header row follows the columns.

- Google Sheets, Salesforce and HubSpot connect from their own card on the form. "Continue with Google" returns to the form you started from (a signed, allowlisted path, never an open redirect), and the card opens connected. A member who is not an admin is told an admin has to connect it.
- Saving new or renamed spreadsheet columns rewrites row 1 of the sheet when it still holds what dForms wrote, and extends it for columns added at the end. A row 1 that does not match is never overwritten on its own: the card shows it beside what would be written and offers "Replace row 1" behind a confirmation, after which row 1 follows the columns by itself. "Update the header row" runs the same sync on demand.
- The Google Sheets card uses the app's own pickers, lines its column rows up as a grid with the sheet's column letters (stacked on a phone), and opens the spreadsheet from a proper button. Picker menus grow to fit their options instead of cutting them off.
- The autosave status is a pill fixed to the bottom-right corner, green when saved and in the destructive tone on an error. On a phone it sits in the flow, where it covers nothing.
