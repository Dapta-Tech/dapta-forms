---
'@quill/web': patch
---

The editor's Publish control reads as one solid pill in every state.

- With changes to publish it is solid Signal Green with dark text, and it stays solid while publishing (a spinner and "Publishing..." instead of a faded button).
- With nothing to publish the whole pill turns neutral grey instead of fading only the Publish half, so it no longer looks like a pale button next to a bright chevron. The chevron still opens the menu.
- The seam between Publish and the chevron is a single thin divider. The doubled rim and the extra border that drew a notch there are gone.
- Keyboard focus draws a dark ring inside the focused half, visible on the green in light and dark themes, instead of a ring the other half covered.
