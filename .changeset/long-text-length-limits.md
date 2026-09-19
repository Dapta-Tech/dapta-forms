---
'@quill/engine': minor
'@quill/types': minor
'@quill/shared': minor
---

Long text questions can require a minimum number of characters and cap the maximum, with a live counter on the public form.

A question like "tell us about your project" is answered in one word often
enough that the answer stops being worth reading, and there was nothing an
author could do about it: the only lever was Required, which a single character
satisfies.

A long text question now carries its own `minChars` and `maxChars`, both
optional. The slider's `min` and `max` live on the same step and are a different
pair entirely, which is why these have names of their own rather than reusing
those.

The floor stops the respondent from continuing, so it is a rule and not a
suggestion, and it comes with a live character counter. Without the counter the
minimum is an invisible wall: you write, you press Continue, and you are bounced
without ever having been told how much was missing. The counter appears only
when the question actually sets a limit, so a question with none looks exactly
as it always has.

Falling short and running over now say so. They used to have no way to be said
at all, and the nearest existing message, "this field is required", is a plain
untruth when somebody has written ten characters. Both messages ship in English
and Spanish.

The ceiling is also enforced when the submission arrives, because the submission
contract put no bound on an answer string at all and a request that skips the
browser could carry any payload. The floor stays browser side, matching how
Required and the phone minimum have always worked. A floor above a ceiling is
refused when the form is saved, and the editor squeezes each box against the
other so the pair can never be typed in the first place.

Nothing changes for a long text question that sets no limits: no counter, no cap
on typing, no new way for an answer to be rejected.
