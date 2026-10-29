---
'@quill/notifications': minor
'@quill/web': patch
'@quill/api': patch
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
