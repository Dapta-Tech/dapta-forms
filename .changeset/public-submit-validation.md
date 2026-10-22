---
'@quill/engine': minor
'@quill/shared': patch
'@quill/db': patch
---

A completed response is now checked against the form it answers.

`validateSubmission(config, answers)` walks the path the answers actually took
(`answeredPath`: skip logic, forward jumps, cut at the first terminal step) and
runs `validateAnswerCode` on every step on it, the same check the renderers run
on each button. The API calls it on every complete, so an option the question
does not have or a missing required answer is refused with `INVALID_ANSWERS`
instead of being stored with an outcome. Steps off the path, hidden steps, URL
prefills nobody saw and UTMs are never read, and partial saves are not checked.

`renderer.errors.invalid_answers` is the respondent's copy for that refusal, in
English and Spanish. `recordSettledDelivery` also records a `skipped` delivery,
which the owner notice now uses when it has nobody to address.
