---
'@quill/web': patch
'@quill/api': patch
---

Google Sheets card: one clear attached state, and changing sheets is deliberate.

- With a spreadsheet attached, the card shows one block that says where responses go: the spreadsheet's name, a sentence naming the tab, and an "Open sheet" button in Google Sheets green that opens it in a new tab. The Sheets logo appears once, in the card's header.
- "Create a new spreadsheet" and "Choose from Google Drive" no longer sit beside an attached sheet, where one click made a second spreadsheet and repointed the form. They are behind "Change sheet", and either one asks for confirmation first: new responses go to the new spreadsheet from then on, and the current one keeps its rows and stops receiving responses. Cancel creates nothing and changes nothing.
- A double click, or a second click while Google is answering, creates one spreadsheet. The button shows a spinner and cannot be pressed until the request ends.
- The card's buttons are outlined secondaries instead of grey pills, and a disabled one both greys and fades. With no sheet yet, "Create a new spreadsheet" is the primary and "Choose from Google Drive" the secondary.
- Attaching a different spreadsheet (or choosing another tab) drops what was recorded about the old one's row 1, also when the new one's row belongs to someone else or Google cannot be reached. The new spreadsheet's header row is written or looked at once, by the save that attaches it.
