---
'@quill/types': patch
---

Report a signing failure as a typed error instead of a bare 500.

Minting an upload or download URL reaches AWS for credentials, and that is the
one step in the flow that fails for reasons the visitor did not cause: no role
attached to the pod, a role whose session expired, a bucket in another account.
Unguarded, every one of those surfaced as an Internal Server Error with a stack
in the log and "that upload did not finish" on screen, which names neither the
cause nor who can fix it. They now return `UPLOAD_UNAVAILABLE` with a 503.

The owner's download route stopped forcing every failure into a 404 as well.
"No such file" and "storage is unreachable" are different answers, and
collapsing them told an owner their file was gone during an outage.
