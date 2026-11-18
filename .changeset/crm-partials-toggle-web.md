---
'@quill/web': minor
---

The HubSpot and Salesforce cards in a form's integrations get a "Send partial responses too" switch. It starts where the delivery rule already is (on for HubSpot, off for Salesforce), writes explicit `events` only when flipped, and leaves an untouched config exactly as stored. Salesforce warns that a partial can create a new Lead with "[not provided]" before the last name or company is answered, both cards say when spam protection holds partials (the switch reads its help, the pause and the warning out through `aria-describedby`), and the Google Sheets card says it only receives complete responses.
