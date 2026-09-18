---
'@quill/web': patch
---

The form editor now shows the same Edit / Analytics / Submissions tabs as the other form screens.

The editor was the only one of a form's three admin surfaces with no way out of
itself: reaching the responses table or the per-question drop-off meant knowing
to leave through the side menu. It now renders the shared `FormTabs` bar above
its own two rows, with `edit` active, so the three surfaces are one click from
each other in both directions.

The back-to-forms link that bar carries replaces the chevron row 1 used to hold:
the same destination, one affordance instead of two stacked.
