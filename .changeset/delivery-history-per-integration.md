---
'@quill/db': minor
'@quill/destinations': minor
'@quill/notifications': minor
'@quill/shared': minor
'@quill/types': minor
---

Every integration carries its own delivery log, and a delivery can be read back.

**The failure list was loud in the wrong place.** The Connect tab rendered one
flat "Deliveries that did not land" block, sitting loose between the integrations
and Tracking and mixing all four outbox kinds. It answered "something is broken"
without answering "which of these three integrations", and on a form with a dead
endpoint its retries pushed Tracking and Emails off the screen — the diagnosis
was louder than everything it was diagnosing. Each card now owns its history, so
the reason a webhook is failing is read beside the URL that is failing.

The log does not live *inside* the card either. A card is a settings form, and
twenty-five rows of history in the middle of one buries the endpoint URL the
reader came for. The card carries a single line — a count, red when something
failed — and the log opens in a dialog where a long list is free to be long.

**It is a history, not a failure list.** The queue never deleted its `done` rows;
nothing had ever asked for them, so a webhook that works and a webhook that has
never fired looked identical. `listFormDeliveries` takes `kinds` and `statuses`
(defaulting to the original failures-only answer, so existing callers are
unaffected), and the `kinds` filter runs in SQL — which is what makes asking for
landed rows viable at all, since they are most of the table. A new
`(account_id, kind, updated_at)` index serves that read; the only index this
table had served the worker's opposite question.

**Deliveries can now be read back.** Three nullable columns record the request
body actually sent and the status and body that came back. The enqueued `payload`
is not those bytes, and only those bytes answer the question every webhook
debugging session opens with. `NULL` means NOT RECORDED — an older row, or a kind
whose adapter has no single request to report — never "an empty body was sent".
Both bodies are truncated on write. An attempt that reports no transcript leaves
the stored one alone, so the last retry of a host that stopped resolving cannot
erase what the endpoint used to say.

**Test deliveries are listed.** The admin's "Send test" is synchronous and never
passed through the queue, so the log stayed empty during exactly the session it
exists to help — wiring up an endpoint, when the test is often the only delivery
that has run. It is a real signed POST, so it is recorded, badged as a test, and
written already-terminal so the worker can never send it a second time.

**Email rows can be attributed to a form.** `SubmissionNotification` never
carried `formId` — it was used to resolve the template and then dropped — so no
email delivery could be traced to the form that sent it. Additive; rows enqueued
before this stay unattributable.
