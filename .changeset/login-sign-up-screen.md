---
'@quill/web': patch
---

A landing's "create an account" call to action can open the hosted sign-up screen. The app root and `/api/auth/login` accept `?screen=sign-up` (that exact value only): the root passes it on to the login route for an anonymous visitor, after the campaign tags it already carries (a signed-in one still goes to the dashboard), and the login route asks the identity service for its sign-up screen. Without it, and on the `/login` redirect a signed-out dashboard visit goes through, the request to the identity service is byte for byte what it was, and the hosted login opens on sign-in.
