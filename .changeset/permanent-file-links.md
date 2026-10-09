---
'@quill/destinations': minor
'@quill/config': minor
'@quill/engine': minor
'@quill/db': minor
---

Webhook payloads now carry a permanent link to every uploaded file.

Until now a file answer reached a webhook as `{ key, name, size, mime }`, and the
key points into a private bucket the receiver cannot read, so the file could only
be opened from the dashboard. Every file answer in the webhook `data` now also has
a `url`, in both the partial and the complete delivery. The change is additive:
`key`, `name`, `size` and `mime` are exactly as before.

The link lives on the deployment's public web address (`PUBLIC_APP_URL`), as
`/file/<token>`, and opens without signing in. PDFs and images open in the
browser; every other file downloads under its original name. Which of the two
is decided by the file extension, never by the type the browser declared at
upload. Each click is redirected to a fresh signed URL that lives a few minutes,
so the bucket stays private and nothing long-lived is ever stored.

The link does not expire. It stops working when the submission is deleted, or
when the signing key changes, which revokes every link already sent at once.
Treat it as a secret: whoever holds it can open the file.

- `@quill/destinations`: `DestinationContext` gains an optional `fileLinks` map
  (step key to link). Only the webhook adapter reads it, adding each link as
  `url` on the matching answer; `data` itself is never modified, so the stored
  submission and the HubSpot destination see the answers exactly as before.
- `@quill/config`: new optional `FILE_LINK_SECRET`. Unset, the signing key is
  derived from `FORMS_ENCRYPTION_KEY`, so a deployment that already has that key
  needs no new configuration. With neither set, or with `PUBLIC_APP_URL` empty,
  payloads carry no `url` and the link route answers 404; nothing else changes.
- `@quill/engine`: `file` and `files` are reserved public slugs, so no account
  can claim a code that the link route would shadow.
- `@quill/db`: `getSubmissionAnswersUnscoped`, the answers of one submission by
  id, for the link route only (its signed token is the authorization).
