---
'@quill/engine': patch
---

Scoring rejects an array answer where the form asks for one choice.

A choice step that is not multi-select used to score every element of an array
answer, and a repeated token was counted once per occurrence, so a crafted or
replayed answer could inflate the total and land the respondent in a higher
outcome bucket. `validateAnswer` now refuses an array on a single-choice step
and refuses repeated tokens on any choice step, and `optionPoints` returns zero
for that shape and dedupes tokens before summing. Stored configs are untouched;
a recomputed score for an affected submission can move down.
