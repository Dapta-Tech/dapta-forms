---
'@quill/shared': minor
'@quill/types': minor
---

Connect HubSpot, Google Sheets and Salesforce from a form's Connect tab, and keep a spreadsheet's header row in line with its columns.

- `@quill/types`: a Google Sheets destination's `settings` may carry `headerSnapshot`, the header row dForms last wrote and where. The API owns it and ignores any value a client sends.
- `@quill/shared`: new copy for connecting in place, for a member who cannot connect, and for each header-row outcome. Every mention of the account page now says Integrations (Integraciones in Spanish), and the Spanish copy uses tú throughout (the last voseo forms are gone).
