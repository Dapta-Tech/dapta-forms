---
'@quill/engine': patch
'@quill/shared': patch
---

A checkbox with no text no longer shows its internal key: its description becomes the box text, or a localized "I agree" when it has neither. Adds `checkboxText` and the `renderer.checkboxDefault` message.
