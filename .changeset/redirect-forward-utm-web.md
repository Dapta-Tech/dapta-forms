---
'@quill/web': minor
---

Forms can forward the visitor's UTM parameters to their redirect (#310).

With `ending.forwardUtm` on, both layouts append the UTMs the submission carried (the form's own, else the landing's) to every redirect: the ending's, an outcome's own `redirectUrl`, and the redirect after a booking, immediate or delayed. The `http(s)` check still runs on the final URL.

The ending panel shows a "Forward UTM parameters" switch as soon as the form or any score range has a redirect, in English and Spanish.
