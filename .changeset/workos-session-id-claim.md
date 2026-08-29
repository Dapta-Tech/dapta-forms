---
'@quill/web': patch
---

Sign-out now matches Orbit's logout contract exactly. The login callback reads the workos_session_id claim from the IAM access token (the callback blob only carries the IAM's own row id), so the upstream revoke stops being a silent no-op. And no logout path sends the browser to WorkOS anymore: sign-out revokes at the IAM, clears the local session, and lands on the signed-out login page, which removes the blank WorkOS page some sign-outs stranded on and removes any dependency on the WorkOS logout-redirect allowlist. As on the Dapta platform, the shared identity session deliberately survives a Forms sign-out.
