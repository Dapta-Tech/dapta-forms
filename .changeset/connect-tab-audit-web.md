---
'@quill/web': patch
'@quill/api': patch
---

Connect tab: five findings from the audit of the save indicators.

- A spreadsheet created from the card is attached to the form even when the Connect tab is left before Google answers. It is saved through the form's save queue, merged onto what the form stores at that moment, and a Connect tab opened again waits for it. The topbar no longer sits on "Saving" for an edit that nothing was going to save.
- "Partly saved" (a webhook switched on with no URL) no longer holds the topbar while the author is in Build, Logic or Design: there the topbar shows the builder's own save, and the condition is marked on the Connect tab's label instead. A failed save or a lost change still shows in the topbar everywhere.
- A change lost after leaving the tab is said in a toast once, not on every visit. The Connect tab shows a notice that stays until it is dismissed, and dismissing it clears the error from the topbar and the pill.
- The Build tab's per-question HubSpot picker and the field-key rename write in line with the Connect tab's save queue. A failed save waiting for its retry is tried first; if it still cannot land it is dropped and reported as lost, instead of being written over the new mapping a few seconds later.
- Clearing the heading of a spreadsheet column that is already in the sheet no longer shifts the columns after it: row 1 is left as it is, responses delivered meanwhile get an empty cell there, and the card keeps the column on its letter with a note saying so. Row 1 is rewritten without the column only when the column is deleted.
