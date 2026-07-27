---
'@quill/engine': minor
'@quill/shared': minor
---

Finishes the option-card work: a real icon picker, centred cards, a canvas that
matches the chosen layout, and logos confined to cards.

The Icon field was a raw text box, which told an author nothing about emoji or
initials being valid — so it only ever received URLs. It is now a picker with a
tab per kind: an emoji library (a curated local set, no new dependency), one or
two letters, and an image URL.

`resolveOptionIcon` becomes the single answer to "what do I draw for this
option", shared by the public renderer, the builder canvas and the live preview
so the three cannot disagree. It also enforces that images are card-only: in a
list an image URL degrades to the label's initials rather than rendering as a
sliver, which means an already-saved list+URL config can't show the broken
combination either. The editor matches by dropping the Image tab under List.

Cards are laid out with wrapping centred flex instead of a fixed three-track
grid, which had stranded a single card in the left third and pinned two cards to
the left edge. Any count now centres, and the per-row count adapts to the width.

`optionInitials` supplies the fallback glyph: up to two letters from the first
two words ("HubSpot Sales" → "HS", "Hubspot" → "H").
