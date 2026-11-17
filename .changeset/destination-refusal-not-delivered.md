---
'@quill/db': patch
'@quill/shared': patch
---

A delivery the provider refused is no longer shown as delivered.

When Salesforce, HubSpot or Google Sheets refused a response for good (a
validation error such as a last name that is too long, a sheet that no longer
exists, a CRM that is not connected, a response with no email to key on), the
delivery was recorded as `done` and the form's history showed it as
"Delivered", even though the lead never arrived. Those rows are now recorded
as `skipped`, with the provider's reason, and are never retried.

- `@quill/db`: `markOutboxSkipped` accepts an optional `transcript`, so a
  skipped row keeps what was sent and what the provider answered, the same
  way `done`, retried and `failed` rows already do. Without one, the stored
  transcript is left alone.
- `@quill/shared`: the history label for a skipped row reads "Not delivered"
  ("No entregada") instead of "Skipped" ("Omitida"), and the Spanish history
  help text speaks to the reader with "tú".
