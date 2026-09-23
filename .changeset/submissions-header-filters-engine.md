---
'@quill/engine': minor
---

`isFilterableChoiceStep(step)` tells which steps the submissions table filters
by: single and multiple choice, and dropdown. `summarizeFacets(steps, rows)`
counts what the header filters offer over every response: the total, how many
are completed and partial, and per choice step how many picked each option, in
the form's option order (then any stored value an option no longer carries).
