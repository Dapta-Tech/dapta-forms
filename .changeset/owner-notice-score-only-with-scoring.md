---
'@quill/api': patch
'@quill/web': patch
---

The owner's "new submission" email no longer prints "Score: 0" for a form with no scoring (no points, ranges or outcomes): the score line drops, as an empty token always did. The form editor's email preview does the same, and now drops lines whose tokens resolve to nothing, like the real email.
