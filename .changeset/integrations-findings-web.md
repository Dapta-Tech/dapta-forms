---
'@quill/web': patch
'@quill/api': patch
---

Integrations: fixes from the review of the Connect tab and the Integrations page.

- The Google Sheets card has a delivery history, like Salesforce's. A spreadsheet that was deleted, or access that was taken away, now shows there.
- The question pickers (Google Sheets columns, Salesforce, HubSpot) show a question with recall tokens the way a respondent without that answer reads it ("Nice to meet you!"), not as raw `[firstname]`.
- "Use the form's questions" no longer adds reveal screens as columns, and adds Score and Outcome only when the form has scoring (Outcome only when it has ranges).
- The dCal picker says why there is no list: dCal is not set up here, sign in again, no booking page yet (with a link to set one up), or dCal did not answer (try again). The API returns a `code` beside the `reason`.
- The red chip in a delivery history reads "Needs attention: N": it counts the rows that failed and the ones a provider refused, which the old "N failed" did not describe.
- The note about test deliveries shows only under the webhook, the one card that can send a test.
- The history names each delivery's moment (Complete response, Partial response, Booking update) and translates the part of a reason dForms wrote, in English and Spanish. The provider's own text is kept as it came.
- dCal's card says "How it works" instead of "Connect", and says "Not available here" instead of "Included" on a deployment without dCal.
- The Notes row of dCal's autofill says Automatic fills it only from a question keyed `notes`.
- A score range's redirect points to Forward UTM parameters, the form-wide switch in When the form ends.
