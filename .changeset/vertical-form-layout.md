---
'@quill/engine': minor
'@quill/types': minor
'@quill/shared': minor
---

Forms can now render as a single vertical page, not only as slides.

`config.layout: 'slides' | 'vertical'` (additive — absent means `'slides'`, so
every published form renders exactly as before; `resolveFormLayout` is the one
place that default lives). The vertical renderer walks the same pure engine
(`runtimeSteps` recomputed on every answer), so skip-logic, goto jumps, dynamic
question variants and branch closing all apply live on the one page.

Layout-specific behavior: the cover renders as a hero header (no Start gate,
its CTA text is unused), reveal steps never play mid-page (one reveal plays
after Submit, before the result), a terminal step with an answer hides
everything after it instead of auto-submitting, schedulers embed inline and
lazy-mount near the viewport, and validation is inline on blur plus a
submit-time sweep that scrolls to the first invalid question.

Funnel events keep their metric semantics across layouts: `step_view` fires
when a question enters the viewport (index 0 on load matches a cover-less
slides form, so Starts stays comparable), `step_complete` when a question first
holds a valid answer, `partial_submit` when the threshold answer becomes valid.

The builder follows: a layout picker in the create dialog and the Design tab,
the canvas drops the per-step progress bar and Next button on vertical, the
cover CTA field is replaced by a note, the reveal switch explains where it
actually plays, and the Design-tab preview sketches the one-page shape.
