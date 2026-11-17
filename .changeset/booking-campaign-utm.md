---
'@quill/web': patch
---

Booking pages keep the visitor's campaign. The dCal and Calendly embeds no longer put the form's session id in `utm_content`, which replaced the campaign's own `utm_content` on every booking they recorded and on the CRM contact their integrations wrote from it. They now receive the visitor's `utm_*` (the form's own, else the landing's, the same set the submission carries); a `utm_*` written into the booking link stays as written. Nothing read the session id from there: a booking reaches its submission through the renderer's own callback, which carries the id itself.
