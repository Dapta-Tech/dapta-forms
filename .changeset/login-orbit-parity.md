---
'@quill/web': patch
---

Sign-in reaches parity with the Dapta platform's auth contract. The "Continue with Dapta" button on the signed-out and error landings now asks the hosted login to actually prompt (prompt=login patched onto the authorize URL, since the identity service does not forward the parameter yet), so signing out followed by signing in offers a real account choice instead of silently re-entering the same session. To make that viable, the web now refreshes its session in place: a 401 from the API first trades the stored refresh token for a new access token (retrying the request once in server actions, or through the new /api/auth/refresh route during a page render) and only bounces to the login page when the refresh token itself is dead. The bare /login auto-redirect keeps the silent single sign-on for people arriving from the Dapta platform.
