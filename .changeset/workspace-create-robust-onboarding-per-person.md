---
'@quill/api': patch
'@quill/web': patch
---

Creating a workspace works again, and the first-run wizard is asked of a person once.

- Creating a workspace projects the new workspace directly after the identity service creates it, instead of relying on a full refresh of the caller's list (a refresh that degrades, because one known workspace does not answer, turned a successful create into "not visible"). When the identity service refuses the create (a plan limit, a rule), its own reason is shown in the dialog instead of a generic "try again".
- A staff refresh that cannot re-read one known workspace (the identity service answers 500 for it) no longer degrades the whole refresh: that row is kept as is, the rest still projects, and workspaces created or joined since still appear.
- The first-run wizard is required of a PERSON once, not of every workspace they are in: someone who finished it anywhere is not sent through it again when the identity service later projects them, as owner, into a workspace whose local row predates them (created by a colleague's access grant, for instance).
- The projection's prune pass spares member rows younger than five minutes: the identity service's list lags its own writes, and a workspace created moments ago is routinely absent from the next list read; disabling that row bounced people out of the workspace they had just created. An affirmative revocation (the workspace was read and no longer names the person) still disables immediately, at any age.
