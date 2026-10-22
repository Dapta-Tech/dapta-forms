---
'@quill/mcp': patch
'@quill/shared': patch
---

Follow-ups to the MCP QA fixes, from their review.

- `update_form` no longer says a problem the form already had "is saved as it
  was" when the save changes it. A repeated option value, step key or outcome
  id is renamed, a rule to a missing step (or to the step itself) is removed
  and an unknown field is dropped: each warning now names that exact change
  (for example, the option value saved as `otro_2`) and points at
  `discard_draft`. Only what the API stores untouched still reads "saved as it
  was".
- `get_form_analytics` counts the days of a range the way the API does (local
  days in the range's time zone), so `daily_truncated` is true whenever the
  daily series was cut, also for epoch-ms bounds.
- `get_form_analytics` tells apart more submissions than starts (responses
  created through the API) from more starts than views (page views that never
  reached dForms), each with its own warning.
- The API reference example for `POST /v1/forms/:id/discard-draft` shows
  `updatedAt` after `publishedAt`, as a real discard leaves it.
