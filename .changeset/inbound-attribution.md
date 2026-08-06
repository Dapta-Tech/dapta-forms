---
'@quill/types': minor
'@quill/db': minor
---

Record where a workspace came from, once. A campaign link arrives with its UTM
tags on the query string, but the root page redirects into the identity provider
and that round-trip leaves our origin — the tags never come back, so nothing was
ever stored and every signup looked like it appeared out of nowhere.
`parseAttribution` allowlists and caps the inbound tags, `claimAccountAttribution`
writes them to `account.attribution` only while it is still NULL, and the web
parks them in a short-lived httpOnly cookie across the login hand-off. First
touch, not last: overwriting on a later untagged visit is how paid campaigns lose
the signups they paid for.
