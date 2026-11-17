---
'@quill/web': patch
---

The editor's Publish control no longer says "Published" over edits that are not saved.

- While an edit is unsaved, saving, being retried or has failed to save, the control reads "Publish" (not yet pressable) instead of "Published" with a check. It used to keep saying "Published" until the save landed, and with the connection down it said so indefinitely. On screens narrower than 1280px, where the "Saved" indicator is hidden, that was the only signal.
- A form with no questions reads "Publish" too, in line with the "Draft" indicator beside it.
- The confirmation dialog for "Revert to the previous published version" shows its text at the normal weight; it was rendered in semibold.
- The control keeps the same width in these states as in the others.
