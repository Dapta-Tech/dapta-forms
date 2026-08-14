---
'@quill/web': patch
---

Multi-select choice questions honor the card layout on the public form.

Layout and selection mode are independent axes of a `multiple_choice` step:
`optionLayout` picks the markup (card grid vs rows) and `selectionMode` picks
the semantics (checkbox toggles + Continue vs radio + auto-advance). The public
renderer collapsed them: any multi-select step fell into the checkbox ROW list
before the layout was ever consulted, so a step configured as cards rendered as
rows — while the builder canvas, which resolves the layout without looking at
the selection mode, kept drawing the card grid. The published form disagreed
with its own preview, which is a bug, not a constraint.

The card grid now renders for both modes. Multi-select cards toggle in and out
of the picked set (`role="checkbox"`, several can be selected at once) and the
form's Continue button submits, exactly like the row list behaves; single-select
cards keep their radio semantics and auto-advance. Option icons — emoji or
image — reach the card in both modes. No config change: forms that stored
`optionLayout: 'cards'` with `selectionMode: 'multiple'` simply start rendering
what their builder preview always promised.
