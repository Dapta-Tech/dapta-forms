---
'@quill/engine': minor
---

`isFilterableChoiceStep(step)` tells which steps the submissions table filters
by: single and multiple choice, and dropdown. `summarizeFacets(steps, counts)`
turns the database's `FacetCounts` into what the header filters offer: the
total, how many are completed and partial, and per choice step each option
with its count and percent, in the form's option order (then any stored value
an option no longer carries, most picked first).
