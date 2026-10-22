---
'@quill/engine': patch
---

`validateSubmission` names the missing sub-field of a name step (`firstname`, `lastname`) and lists its fields, instead of the step's own key, which a name step never stores under.
