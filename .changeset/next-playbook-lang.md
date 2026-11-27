---
'@quill/web': minor
---

The return path (`?next=`) keeps the reader's language on a playbook, so someone who signs up from the English resources hub opens the playbook in English instead of in their platform's language.

- A playbook page or the gallery may carry exactly `?lang=es` or `?lang=en`: `/admin/playbooks/<slug>?lang=en`, `/admin/playbooks?lang=es`. It rides through the login, the callback and the onboarding wizard untouched.
- Every other query is still refused as a whole, as before: another language, a second parameter, any other parameter, or `lang` on a page outside `/admin/playbooks`. The visitor then lands on `/admin`. The guard never trims a value it did not fully recognize.
- The other rules are unchanged: a path inside the dashboard, at most 200 characters (the language counts), no host, no scheme, no `..`.
