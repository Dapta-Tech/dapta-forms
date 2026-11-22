---
'@quill/web': patch
---

The login route records `forms_login_started` with the hosted screen it opens (`sign-up` or `sign-in`), so drop-off on the hosted sign-up screen can be measured. Sent from the server with Next's `after` once the redirect has gone out, never in front of it, filed under the landing's `ph_id` when there is one; nothing is sent with product analytics off or for an automated client, and a failed send is one log line.
