---
"@quill/engine": minor
---

A new scheduler step is a dCal scheduler. It is Dapta's own, it needs no
credential to connect, and the respondent never retypes what the form already
asked; Calendly stays one pick away in the panel.

`createEmptyStep` writes the provider EXPLICITLY, and every reader still
resolves an absent one to Calendly. That split is the whole of the back-compat
story: a scheduler authored before dCal existed carries no provider, and reading
the absent value as dCal would silently repoint all of them at a booking page
that is not theirs.
