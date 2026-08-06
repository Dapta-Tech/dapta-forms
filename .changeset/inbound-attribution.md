---
'@quill/types': minor
'@quill/db': minor
---

Record where a workspace came from, once. A campaign link arrives with its UTM
tags on the query string, but the root page redirects into the identity provider
and that round-trip leaves our origin — the tags never come back, so nothing was
ever stored and every signup looked like it appeared out of nowhere.

`parseAttribution` maps the URL's snake_case tags onto the camelCase shape
`attributionSchema` has always declared for this column (plus `gclid`/`fbclid`,
the paid-click ids), allowlisting and truncating as it goes.
`claimAccountAttribution` writes them to `account.attribution` while it is still
NULL **and the account is newborn** — NULL alone is not evidence of a new
workspace, since every account predating this feature has a NULL column, so
without the age bound the first tagged login by a long-time customer would
permanently stamp their workspace with a campaign it predates. The web parks the
tags in a short-lived httpOnly cookie across the login hand-off. First touch,
not last: overwriting on a later untagged visit is how paid campaigns lose the
signups they paid for.
