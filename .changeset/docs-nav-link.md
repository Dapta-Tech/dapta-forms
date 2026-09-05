---
'@quill/shared': patch
---

A "Docs" item in the rail, in the reader's language.

The left nav gains a permanent "Docs" entry (book icon) right above "Dapta
Agents". It opens the Forms documentation in a new tab: the English site for
an English interface, the Spanish site for a Spanish one. The URL lives in the
message catalog (`admin.chrome.docsHref`) because the shell only receives the
localized messages, and it carries the same in-app UTM tags as the other suite
doors (`utm_source=forms`, `utm_medium=sidebar`).

- i18n: `admin.chrome.docsHref` and `admin.chrome.nav.docs` (EN + ES).
