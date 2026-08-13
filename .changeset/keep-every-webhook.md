---
'@quill/shared': patch
---

Stop the Connect tab from deleting a form's other webhooks.

A form may legitimately store several webhooks — only HubSpot is capped at one —
but the Connect tab's webhook card reads the FIRST and used to be the only one
the save path wrote back. So on a form with two, any edit made on that tab
deleted the second: not just an edit to the webhook, but a HubSpot toggle or a
tracking field, because autosave rewrites the whole `destinations` array. It
happened silently and could not be noticed, since the deleted webhook was never
rendered on that screen.

The save path now carries every webhook the card does not edit, verbatim and in
its stored order, on all three of its branches — including the one where clearing
the URL removes the first webhook, which must not take its siblings with it. They
sit beside the edited one rather than at the end, because a destination's index
in that array is part of its delivery idempotency key.

The card says so too, in the slot that survives the card being switched off — the
state where it matters most, since flipping that switch is itself an edit. Unlike
the HubSpot notice it sits next to, this one reports something kept rather than
something about to be lost, and points at the account's Integrations page, where
all of a form's webhooks are now listed.

Not fixed here: the card still edits only the first webhook. Making it manage
several means add/remove controls and a test-delivery endpoint that can be told
which webhook to ping — a change to the API contract, not to this screen.

Adds `admin.integrations.carriedWebhooks*` to the message catalog in both locales.
