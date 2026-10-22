---
'@quill/mcp': patch
---

Tool fixes from end-to-end QA:

- `get_form` lists the form's `destinations` (with their ids, secrets masked), so `set_destinations` has a list to start from, as its description now says.
- `ping_webhook` reports the status the endpoint answered on success too, and says what the test delivery carries.
- A refusal points at `get_form_guide` only for a form config; the brand kit, notification and destination tools no longer end with it.
- `update_notification` and `update_form_notification` list in `warnings` a `{{token}}` the emails do not know (it reaches the inbox as written), with the valid ones.
- Clearer descriptions: how to clear the brand kit (`{}`, or `null` on the fields that take it), that a `logo` should be https, that `apply_brand_kit` clears the editor's `themePreset` and `revert_brand_kit` brings it back, and that a CSV header or a summary names a question with its `[placeholder]` as written.
