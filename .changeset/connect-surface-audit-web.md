---
'@quill/web': patch
'@quill/api': patch
---

Connect surface: three findings from the audit, and one rule written down.

- A member is no longer offered what the API reserves for owners and admins. On a form's Connect tab the "Choose from Google Drive" button is replaced by a sentence (creating a spreadsheet and updating the header row stay available, since the API allows them), and the webhook test is disabled with the reason beside it. On the Integrations page a member sees what is connected, with a sentence in place of the Connect and Disconnect buttons.
- A connect attempt the API refuses is explained in the reader's language, by the API's reason code (no encryption key on the server, a provider this deployment cannot connect, a role that may not connect), with a generic sentence for anything else. The API's own English message is never shown in a toast or under the form.
- Stated, not changed: for a spreadsheet picked before header-row snapshots existed, a row 1 that is exactly equal to the form's stored columns follows the configuration, whoever typed it, so the first rename in dForms rewrites it without a confirmation. A row 1 that differs in any cell is never touched without the confirmed replace.
