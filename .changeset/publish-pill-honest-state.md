---
'@quill/web': patch
---

The editor's Publish control no longer says "Published" over edits that are not saved, and says why when it cannot be pressed.

- While an edit is on its way to the server the control reads "Saving..." with a spinner, instead of "Published" with a check. If that save is being retried, has failed or hit a conflict, it reads "Publish" and cannot be pressed. It used to keep saying "Published" until the save landed, and with the connection down it said so indefinitely. On screens narrower than 1280px, where the "Saved" indicator is hidden, that was the only signal.
- The control follows the save of the form itself, not of its integrations. A webhook switched on without a URL, or an integrations change that did not save, no longer leaves it on "Publish" after a publish that went through: it reads "Published". The indicator in the top bar still reports both.
- A form with no questions reads "Publish" too, in line with the "Draft" indicator beside it.
- Whenever Publish cannot be pressed it says why: saving your changes, your changes could not be saved, the form was saved from somewhere else, add a question first. The reason shows as a tooltip on hover, on keyboard focus and when the button is pressed, and screen readers read it as the button's description. The button stays reachable with the keyboard in every state.
- On a phone the reason appears under the whole top bar, so it does not cover Preview or the link tools, it never takes a tap meant for what is under it, and it goes away on the next tap elsewhere, on a scroll, or by itself after a few seconds. Escape closes it from anywhere.
- The confirmation dialog for "Revert to the previous published version" shows its text at the normal weight; it was rendered in semibold.
- The control keeps the same width in all of these states.
