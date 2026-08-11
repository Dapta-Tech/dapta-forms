---
'@quill/types': minor
'@quill/shared': minor
---

The booking date property records the day the lead BOOKED, and a form may carry
only one HubSpot destination.

**Behaviour change:** `hubspot.bookingSync.dateProperty` now receives the
calendar day the booking happened, not the day of the meeting. The two differ
whenever someone books ahead, and this property is what monthly "meetings
booked" reporting counts by — a demo booked Aug 31 for Sep 3 was landing in
September. The meeting's own start time is unaffected: it has always been, and
remains, `hoursProperty`.

Two consequences follow from the same change. The day is no longer gated on a
resolvable meeting start — a provider that reports no start time still tells us
a booking happened, so the date is written and only `hoursProperty` is skipped
(this restores parity with the pilot this flow replaced). And the new
`bookingSync.dateTimezone` chooses the IANA zone that day is floored in;
blank/absent stays UTC, the platform default, so no stored config changes
meaning. A portal reporting in `America/Bogota` should set it, or every booking
from 19:00 local onwards is recorded on tomorrow. An unusable zone warns and
falls back to UTC rather than failing the delivery.

`@quill/types` also exports `hasExtraHubspotDestination` and
`ONE_HUBSPOT_DESTINATION_MESSAGE`: a form may be written with at most one
HubSpot destination. A second one is a trap because the three readers resolve
the pair three different ways: the Connect screen edits the FIRST regardless of
`enabled`, submit delivers EVERY enabled destination, and booking resolves the
first ENABLED one. The second is therefore always invisible in the admin, and
which of the two is doing anything depends on flags that screen never shows —
on a disabled-first pair it is the second that runs bookings. It was a workaround
from when a field mapping was one question → one property; a mapping now fans
out to several, so the case is covered. Enforced on the two paths that AUTHOR a
destinations array (`PUT /v1/forms/:id/destinations` and `POST /v1/forms`);
`PUT /v1/forms/:id` stages a draft, and drafts strip the key. Deliberately NOT
in `formConfigSchema` — a form that already stores two must keep parsing and
stay editable, which is how it gets fixed — and deliberately not on duplicate,
which copies stored state rather than authoring it, so the copy inherits the
violation instead of becoming uncopyable. Multiple webhooks are unaffected.

The rule is "never go UP", not "never hold two": `hasExtraHubspotDestination`
takes the STORED array as its second argument and refuses only an increase.
Several screens edit one field and write the whole array back — the builder's
per-question property picker and its field-key rename both do — so a form that
already carries two round-trips two on every unrelated save, and a count-only
guard would refuse those writes and make the picker unusable on precisely the
forms this rule exists to clean up.

The Connect screen now says so: a form storing more than one HubSpot destination
shows a notice on the HubSpot card that the extra one is invisible, is not
running at booking time, and will be dropped when the tab next saves — the
collapse was already the behaviour, silently.
