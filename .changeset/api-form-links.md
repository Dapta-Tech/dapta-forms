---
'@quill/shared': minor
'@quill/db': minor
---

The admin API now returns each form's links: `publicUrl` and `editorUrl`.

An agent working through the API had no way to hand a person the form it just
built: the link was never in a response, so it had to guess the shape, and most
guesses were wrong. Every route that returns a form (`POST /v1/forms`,
`GET /v1/forms/:id`, each item of `GET /v1/forms`, `PUT /v1/forms/:id`,
`PUT /v1/forms/:id/slug`, duplicate and publish, plus the `current` form of a
409 `STALE` answer) now carries both:

- `publicUrl` is the form's public link, the same one the dashboard copies: the
  workspace's current public code (its vanity slug once it claims one) and the
  form's current slug, so it follows a rename.
- `editorUrl` opens the form in the builder.

Both are absolute URLs on `PUBLIC_APP_URL`. A deployment that leaves it empty
gets `null` for both, and nothing else changes.

To keep one rule for the link, `publicFormPath` and `PUBLIC_FORM_SEGMENT` moved
from the web app into `@quill/shared`, next to a new `formEditorPath` and a
`formLinks` helper that joins both onto the app URL; the web re-exports them
from where it always imported them. `@quill/db` gains `getAccountPublicCode`,
which reads one workspace's canonical public code.
