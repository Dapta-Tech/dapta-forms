---
'@quill/shared': patch
---

Trim trailing slashes and anchor dashes with a linear loop instead of a backtracking regex, so a long run of the same character can never stall the API reference or the form links.
