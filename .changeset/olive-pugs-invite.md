---
'@quill/engine': minor
'@quill/shared': minor
---

Map a booking's own fields from the question panel. A scheduler step answers with
a booking — the meeting time under its own key, the invitee's name and phone under
theirs — but the builder offered one unlabelled "Map to" picker that bound only
the first of those and never said which. `bookingFieldsFor` names the whole set so
the question panel and the Connect screen read one list.
