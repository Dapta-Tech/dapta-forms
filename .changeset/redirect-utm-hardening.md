---
'@quill/engine': patch
'@quill/shared': patch
---

Forwarded UTMs are stricter: a redirect only receives plain `utm_*` keys (letters, digits and `_` after the prefix), at most 10 of them, and none whose value is over 200 characters. A bracket key such as `utm_source[]` is no longer appended, so it can no longer win over a `utm_source` the owner wrote into the URL. The redirect hint in the score range dialog now points at the "Forward UTM parameters" switch.
