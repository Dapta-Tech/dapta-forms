---
'@quill/notifications': minor
'@quill/shared': patch
'@quill/config': patch
---

A question screen keeps its Continue button on screen. A long option list (or a
screen of several questions) scrolls inside the card instead of pushing the
button below the fold; the Build canvas shows the same cap. The editor gets a
Results link that opens the form's responses.

Notification emails wear the dForms brand: an accent bar, the wordmark (served
from `PUBLIC_APP_URL`, with the name as type when there is none), a bordered
card, a ruled answers table and real links. The message now names its language,
so the transactional service's footer matches the body, and the page's side
padding sits on `<body>`, which also insets that footer.

Both submission emails end with a green "Create your form, free" button (in the
email's language) when the deployment has the growth loop on, the same rule as
the "Made with" badge. The API now reads `NEXT_PUBLIC_SIGNUP_URL`,
`NEXT_PUBLIC_LANDING_URL` and `NEXT_PUBLIC_HIDE_BADGE` too; the links carry
`utm_medium=email-receipt` or `email-notice`.
