---
'@quill/destinations': patch
---

A test delivery carries `test: true` at the top of the webhook payload, apart from `data`, so it can never collide with a step keyed `test`. Real deliveries carry no `test` key.
