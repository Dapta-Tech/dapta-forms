---
"@quill/engine": patch
---

A dCal scheduler no longer counts as a form's email source. Calendly's invitee
is fetched back after a booking; dCal's is not, and its booked message carries
no address on purpose, so a form whose only contact source was a dCal scheduler
reported its CRM contact key as covered while every lead failed to sync with
"no respondent email resolvable". It now reports no source at all, which is
what sends the author to add an email question. Making dCal the default is what
turned this from an opt-in path into the common one.
