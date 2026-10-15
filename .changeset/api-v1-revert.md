---
'@quill/db': minor
'@quill/shared': minor
---

Revert a form to its previously published version, by API or from the editor.

Publishing directly is safe because it can be undone in one click.

- Every publish now keeps the live config it replaces (`previous_config`) and
  when that version went live (`previous_published_at_ms`: the last publish,
  or the form's creation for a form that was live before its first publish).
- `POST /v1/forms/:id/revert` puts the previous version back live, and the
  version it replaces becomes the previous, so reverting twice undoes the
  revert. The destinations the form has now are kept, and a pending draft is
  not touched. With nothing to go back to it answers 409 `NOTHING_TO_REVERT`.
  An API key may call it. The public form serves the reverted version as soon
  as the call returns.
- Form responses carry `previousPublishedAt` (epoch-ms, or null when there is
  nothing to revert to). The stored version itself stays on the server.
- In the editor, the Publish button gains a menu with "Revert to the previous
  published version". It shows when that version went live, is disabled while
  there is none, and asks first in a dialog that names the date and says the
  draft does not change.
- `@quill/db` gains `revertForm` and `FormRow.previousPublishedAt`;
  `@quill/shared` gains the `admin.publish` revert copy (EN + ES).
