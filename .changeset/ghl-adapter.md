---
'@quill/destinations': minor
'@quill/types': patch
---

HighLevel destination adapter. With a connection (a Private Integration token and a Location ID), the destination factory now builds `GoHighLevelDestination` instead of the no-op: each submission is upserted as a contact of the sub-account (`POST /contacts/upsert`), then its fixed tags are added with `POST /contacts/{id}/tags`, which only adds. Empty answers are never sent, so they never clear a value GHL already has; a phone goes as E.164 when it carries its country; each custom field gets its value in the shape its type takes (a number only when the answer is one, a list for multiple choice and checkbox, a date as the day in the destination's zone). A 401 or 403 from GHL skips the delivery with a reconnect reason and calls `onRejected`; a 400 or 422 skips it with GHL's message; a Cloudflare refusal, 429, 5xx or network error throws so the outbox retries. Without a usable connection the factory keeps the named no-op. The `@quill/types` change only updates comments that said no adapter existed yet.
