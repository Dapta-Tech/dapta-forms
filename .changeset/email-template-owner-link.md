---
'@quill/notifications': patch
---

A template line whose tokens all come out empty is still dropped, unless the owner wrote an http(s) link on it: "Gracias {{respondentName}}. Agenda: https://..." keeps its link on a form with no name question.
