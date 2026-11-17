---
'@quill/web': patch
---

The editor's Publish control reads as one solid pill in every state.

- With changes to publish it is solid Signal Green with dark text, and it stays solid while publishing (a spinner and "Publishing..." instead of a faded button).
- With nothing to publish it says "Published" with a check, on a solid surface with a green rim and full-strength text, instead of a faded Publish half next to a bright chevron. The chevron still opens the menu with the revert action.
- The pill keeps the same width in every state, so the topbar no longer shifts when publishing starts or ends.
- The seam between the two halves is a single thin divider. The doubled rim and the extra border that drew a notch there are gone.
- Keyboard focus draws the same rounded ring inside whichever half has focus, visible in light and dark themes.
