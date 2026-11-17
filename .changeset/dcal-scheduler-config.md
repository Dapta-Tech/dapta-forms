---
"@quill/config": minor
---

Add `DCAL_API_BASE_URL` and `DCAL_APP_URL`, the two hosts of dCal: its API
serves `/v1`, its app serves the booking pages and the event-type editor.

There is deliberately no token beside them. dCal projects the same identity
service this app does, so the author's own session is forwarded to it and
nothing is stored or encrypted. Both are absent in a bare fork, which reports
dCal unavailable and offers Calendly, the same graceful degradation every other
integration has.
