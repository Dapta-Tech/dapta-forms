---
"@quill/web": minor
---

Render a dCal booking page in a scheduler step or an outcome handoff. The embed
is a declarative iframe, the way dCal's own snippet does it: there is no script
to load, and the page reports its own height by postMessage, which this screen
listens for itself instead of loading dCal's `embed.js`.

A respondent never retypes what the form already asked. Their name, email and
notes ride the embed URL, and each of the event type's own questions rides it
under `answer_<fieldName>`, the parameter dCal reads it by. The field mapping is
therefore resolved by field NAME for dCal, where Calendly's is positional: an
event type may have a field named `phone`, which under Calendly's rules would
have been read as the legacy built-in and sent to the wrong slot.

The booked signal is trusted only from the origin of the booking page that was
actually embedded. dCal is self-hostable, so there is no origin to hardcode, and
it posts with `targetOrigin: *`: without that check any framed page could claim
a booking for the session.
