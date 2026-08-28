---
'@quill/web': patch
---

Sign-out now reaches WorkOS with the session id it can actually resolve. The login callback reads the workos_session_id claim from the IAM access token (the callback blob only carries the IAM's own row id), so the logout revoke and the IdP logout URL stop being silent no-ops that stranded the browser on a blank WorkOS page and let the next sign-in silently re-authenticate the same person. Sessions stored before this change carry the old id; for those the sign-out skips the WorkOS hop and lands directly on the signed-out login page.
