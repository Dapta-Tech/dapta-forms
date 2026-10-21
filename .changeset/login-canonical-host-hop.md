---
'@quill/web': patch
---

A sign-in started on another hostname now works. When `PUBLIC_APP_URL` is set and `GET /api/auth/login` arrives on a different hostname (for example an old domain that keeps serving after a domain move), the route answers a 302 to the same path and query on the `PUBLIC_APP_URL` origin before it sets any cookie. The sign-in state cookie is host-only and the callback is always on `PUBLIC_APP_URL`, so such a sign-in used to end on `/login?error=state`. Campaign tags, `ph_id`, `next` and `prompt` ride along unchanged and are parked on the host whose callback reads them. Hostnames are compared case-insensitively, read from the first `X-Forwarded-Host` entry, else `Host` (the order Next's Server Actions origin check uses); port and scheme are ignored. Without `PUBLIC_APP_URL`, or on its own host, nothing changes.
