---
'@quill/web': patch
---

The HubSpot, Google Sheets and Salesforce pickers offer a name question as its two stored answers, first name and last name, instead of its own key, which never holds an answer. Mapping a name question to a CRM field or a sheet column now delivers the name. Auto-map sends each half to `firstname` and `lastname`, a new spreadsheet gets one column per half, and a key saved before this change keeps showing as itself in the Salesforce and Sheets pickers.
