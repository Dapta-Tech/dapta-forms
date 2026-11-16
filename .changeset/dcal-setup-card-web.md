---
"@quill/web": minor
---

Map each field a dCal event type's booking form asks for to an earlier answer,
the way the Calendly panel does, keyed by the field's NAME rather than its
position. The three fields dCal always asks (name, email, notes) head the list,
then whatever the picked event adds.

A dCal scheduler with no event type yet now shows a setup card on the canvas
instead of Calendly's "nothing picked" line: dCal's own mark, what it is, and
the only two moves that make sense there, pick one of the event types you
already have or go make one. The picker itself stays in the settings panel, so
there is one control rather than two that can disagree. Once an event is picked
the canvas embeds its real booking page.

A scheduler that names no provider is unaffected: it is Calendly, and renders
exactly as it did.
