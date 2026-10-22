---
'@quill/engine': patch
---

Reserve `preview` and `onboarding` as public slugs. Both are static routes at
the root of the web app, so a vanity slug with either name would have been
shadowed by them.
