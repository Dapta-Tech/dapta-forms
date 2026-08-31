---
'@quill/db': patch
---

A personal workspace whose upstream id equals its account id no longer destroys itself. `rebindLegacyAccount`'s two lookups resolved to the same row for those workspaces, so on the owner's second session the account parked itself (or, with no forms, deleted itself through the absorb branch), and every later login crashed on the parked row's unique `external_id`: a permanent lockout behind the "Something went wrong" screen. The rebind now recognizes the row as already bound and returns it untouched, and migration 0018 moves the stranded forms of every self-parked pair into their live twin, suffixing colliding slugs and retiring the parked account's public codes into `account_alias` so shared URLs keep resolving.
