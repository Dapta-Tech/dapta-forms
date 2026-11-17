---
"@quill/types": minor
"@quill/engine": minor
---

Add dCal as a third scheduling provider, beside Calendly and HubSpot Meetings.
`bookingProvider` and `formSchedulerSchema.provider` accept `dcal`, and the
public booking callback gains an optional `bookingUid`: dCal names a booking
rather than addressing it, and `eventUri` is validated as a URL and fetched as
one by the HubSpot booking sync, so a uid could not share that field.

dCal needs no connected credential. It projects the same identity service this
app does, so the author's own session is what lists their event types, and the
page it embeds is a plain URL.
