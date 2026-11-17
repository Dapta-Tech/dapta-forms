---
'@quill/engine': patch
---

Forwarded UTMs are stricter: a redirect only receives plain `utm_*` keys (letters, digits and `_` after the prefix, 64 characters at most), at most 10 of them, and none whose value is over 200 characters. The 10 are counted after dropping the keys the owner already wrote into the URL. A bracket key such as `utm_source[]` is no longer appended, so it can no longer win over a `utm_source` the owner wrote into the URL.
