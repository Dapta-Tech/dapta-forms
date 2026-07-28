---
'@quill/destinations': minor
'@quill/shared': minor
---

Say why a webhook test delivery failed.

The toast read `Test failed: webhook delivery failed: HTTP 400` — true, and
useless. A status code alone sends the author to check the wrong thing.

`WebhookHttpError` now carries the status and a truncated copy of the endpoint's
own response body, which names the real reason far more often than the code does.
Its `message` is byte-identical to what the adapter always threw, because the
outbox stores that string and two tests assert on it — it is a contract, not
prose.

The classification is deliberately conservative. Only 405/501 lets us state that
POST is refused, because that is the one status which actually says so. A 400
means the endpoint read the request and rejected the body; claiming the method
was wrong there would be right often enough to be trusted and wrong often enough
to waste an afternoon. So 4xx copy states what we send — POST, `application/json`
— and lets the endpoint's own message do the rest.
