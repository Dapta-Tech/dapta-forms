---
'@quill/db': patch
'@quill/shared': patch
---

Staff requests stop crawling, and the staff search finds workspaces by what staff actually hold.

- A staff person's workspace refresh no longer pages through the whole estate (to a staff token the unscoped upstream search answers with every workspace there is; reading thousands of rows on every TTL and every switcher open made each request take 10 to 50 seconds). It now reads the workspaces of their own upstream account (the search scoped with `accountId`) plus, in parallel, every workspace this database already knows them in, so revoked memberships are still disabled and a grant whose workspace now names them still becomes the real membership. A membership in someone else's account that was never projected is found when they enter it from the estate search, which projects that one workspace directly.
- The staff search also matches the accounts this database already projected by workspace name, member email or form name (the identity service only knows names, and staff usually hold a form link or the customer's address). Such rows say why they matched (the email, or "Form: name"), in the switcher and on the Account settings cards.
