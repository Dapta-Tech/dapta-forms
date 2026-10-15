---
'@quill/web': minor
'@quill/api': minor
---

`[name]` shows the full name everywhere a form recalls an answer, and the dForms API skill documents `@score`.

- Public form, both layouts: `[name]` in questions, descriptions, outcome headings and texts, the thank-you screen and the redirect URL is the respondent's first and last name. The redirect URL fills its `[key]` tokens too, percent-encoded, on the immediate redirect, the delayed one and the one after a booking. Only on the form's own page: embedded (in an iframe or with `?embed=1`), every query parameter with a token is left out, so neither the host page nor the destination receives an answer.
- Editor: the @ picker offers `[name]` after a `name` step, and typing it no longer raises a warning. The scheduler autofill keeps listing answer fields only.
- Notification emails: `{{respondentName}}` is a new variable chip in Settings and in the form's Connect tab, with a sample name in the preview. The API fills it from the submission.
- API skill: SKILL.md explains `@score` (the running score of the steps shown before, not counting the step itself), the order of the screens and the placeholders, including `[firstname]`, `[lastname]` and `[name]`. The JSON Schema describes `@score` on a condition's `field`, a new recipe `gate-a-step-by-score.md` hides a booking step below 14 points, and the responses example stores `firstname` and `lastname` as a `name` step really does.
