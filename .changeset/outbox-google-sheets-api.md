---
"@quill/api": patch
---

The outbox worker delivers Google Sheets rows. It dispatched only `webhook` and
`hubspot` to the destination handler, so every spreadsheet delivery was retried
five times as an `unknown outbox kind` and marked failed: the response was
saved, and never reached the sheet. The kinds it dispatches are now an
exhaustive record over the destination types, and the enqueue no longer casts,
so a destination added without an outbox kind fails to compile.
