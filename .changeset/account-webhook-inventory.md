---
'@quill/shared': minor
---

List every form's webhook on the account's integrations page — and make failed deliveries visible at all.

The Connections page offers HubSpot and Calendly, the two things you connect once
per account. Webhooks are configured per form, so they were nowhere on it: the
only way to answer "which of my forms send data out, and where?" was to open each
form's Connect tab in turn. The dashboard's own shortcut to that page has always
been labelled "Integrations & webhooks", a promise the page did not keep.

It keeps it now. Below the connections grid — a separate section, not a fourth
card, because a webhook has no token and no connection state to report — sits an
inventory: one row per webhook, with the form that owns it, the endpoint, whether
a signing secret is set, which submission phases it fires on, whether it is
enabled, and a link into that form's Connect tab. Editing stays with the form.
Disabled webhooks are listed rather than hidden; one that quietly stopped firing
is the case worth finding here. A form that stores two webhooks shows two rows,
because two is a legal configuration and an inventory that rounds it down would
disagree with what is stored.

Fixing the delivery column turned up a bug that predates it. The admin matched an
outbox row to a form by a top-level `formId` in its payload, but destination rows
carry `{ destination, ctx }` with the id in `ctx` — so **no webhook or HubSpot
failure had ever been visible in the admin**, including in the per-form "deliveries
that did not land" panel built to show exactly that. Only `booking_sync` rows
matched, which is why every test passed over the hole. The matcher now reads both
shapes. That panel starts working on forms where it had always rendered nothing,
and the account inventory can show a failure count without any new storage: same
rows, same account scope in SQL, grouped per form.

There is deliberately no "healthy" badge. Successful deliveries are not queried,
so a queue with no failures cannot be told apart from a webhook that has never
run, and claiming health for the second is worse than saying nothing.

Adds `admin.connections.webhooks` to the message catalog in both locales.
