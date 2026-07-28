---
'@quill/engine': minor
'@quill/shared': minor
---

Say why a HubSpot sync cannot work, and let an author test a webhook without
waiting for a respondent.

**A form with no email address silently never syncs.** HubSpot's upsert is keyed
on email — it matches a contact by address and creates one when there is none —
so a submission that carries no address arrives with nothing to identify. That
delivery resolves as a permanent no-op: no error, no retry, no contact, and
nothing an author would ever look at. The editor now says so while the form is
being built, before any lead is lost. New pure helper `emailSourceFor(config)`
returns where an address could come from: an `email` question (a hidden one
counts — it still captures `?email=`), else a scheduler, since Calendly collects
the invitee's address at booking. A question wins over a scheduler because it
does not depend on anyone booking.

The Connect tab also explains what the sync actually does. "Map a question to a
property" never told anyone the contact is matched by email and created when
absent, which is the single rule that decides whether a lead lands.

**Webhook test delivery.** A new admin-only endpoint posts one sample body to the
form's configured webhook — the real payload shape with sample answers built
from the form's own steps, signed the same way, carrying `test: true` and a
`test-submission` id so a receiver cannot mistake it for a lead. It runs through
the real `WebhookDestination`, which is the point: an endpoint that makes the
SERVER fetch a URL the USER supplied is the textbook internal-network probe, and
reusing the adapter means the SSRF guard cannot be forgotten. Private, reserved
and cloud-metadata addresses are refused with no request leaving the process.
Loopback is permitted only when the stored hostname is literally `localhost` —
the same carve-out the URL validator makes for a local catcher — so an https
host that merely resolves to 127.0.0.1 stays blocked.

New `admin.integrations` strings in EN and ES for the email gate, the sync
explanation, and the test button.
