---
'@quill/engine': minor
'@quill/types': minor
---

Give the question panel a hierarchy, and surface the URL prefill nobody could
find.

The panel was seventeen sections in one flat scroll, all weighted the same, so
the two controls an author touches constantly sat beside the one that renames an
answer key and cascades through every condition, goto, variant and CRM mapping.
Conditional visibility, dynamic question, behaviour flags, the field key and
per-question scoring now live in a collapsed **Advanced settings** group.

**Skip-logic stays out of it.** Forward rules (`goto`) are the reason someone
picks this over a plain form builder; burying them would hide the product's own
argument. Show/hide conditions moved in, per the same judgement applied the other
way: they are declarative and rarely revisited once set.

**The badges are load-bearing, not decoration.** A collapsed group that hid a
question being conditional, terminal or hidden would be strictly worse than the
flat list it replaces — the author would see a clean question and have no idea it
behaves differently. The header names what is configured inside, in the same
vocabulary the left spine already uses, and the group opens on its own when
anything is set.

**URL prefill existed and was invisible.** `capturePrefill` already seeds any
declared field key from the query string, visible questions included — the
runtime has done this all along. What never existed was any way to learn that the
parameter *is* the field key. The new row states it and shows a copyable example
built from the question's own type and options, so a choice question does not
demonstrate itself with an email address. A `name` step shows both of its
subfield parameters, because showing one would be wrong. A key beginning `utm_`
gets a warning instead of an example: those are captured separately as campaign
data, so prefill silently does nothing for them.

**New: a default answer.** `defaultValue` on a step, seeded by `captureDefaults`
in both renderers with the precedence `default < URL < what the person types`. A
campaign link carrying `?email=` has to beat a default the author set months
earlier, or the link would quietly do nothing. `name` and `scheduler` steps take
none — one writes two subfields, the other's answer is a booking.

The per-question HubSpot mapping leaves the panel. The Connect tab already
carries the full mapping with auto-map, custom rows and value maps; two places to
set the same thing is how they drift apart.
