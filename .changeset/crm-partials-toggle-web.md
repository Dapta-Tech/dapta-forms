---
'@quill/web': minor
---

The HubSpot and Salesforce cards in a form's integrations get a "Send partial responses too" switch. It starts where the delivery rule already is (on for HubSpot, off for Salesforce), writes explicit `events` only when flipped, and leaves an untouched config exactly as stored. Salesforce warns that a partial without a last name or company creates a Lead with "[not provided]", both cards say when spam protection holds partials, and the Google Sheets card says it only receives complete responses.
