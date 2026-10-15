---
'@quill/web': patch
---

The API skill says which step type to use for each kind of question, and names the responses and analytics routes up front.

- `SKILL.md` gains a "Step types" table, and the quiz recipe now asks for the person's name with a `name` step before the email. In the end-to-end test of the API with the skill, a smaller model asked for the name with a `text` step in three of its four quiz runs, because nothing in the skill said that `name` exists for that. dForms titles each response after its `name` step, so those quizzes collected leads without a name.
- `SKILL.md` gains a short "Responses and analytics" section with `GET /v1/forms/{id}/submissions` and `GET /v1/forms/{id}/analytics`. The same model guessed a `/responses` route in three of its four response and analytics runs before it found the right one.

With the updated zip, the same model got eight runs out of eight right (quiz with and without example forms, responses, analytics), with no 4xx.
