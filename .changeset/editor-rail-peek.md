---
'@quill/web': patch
---

The form editor's side rail now opens on hover.

The editor rests on a 64px icon rail so the builder gets the canvas, but with
no labels there was no way to tell where any icon led, so people clicked one at
random just to get out of the editor. The rail now widens to 240px while the
pointer is over it, or while the keyboard focus is inside it, and collapses
again when both leave.

It does that without moving the canvas: the rail leaves the layout flow, a
fixed 64px spacer holds its column, and the expanded panel is painted over the
builder. Reflowing a full-height three-column editor every time the pointer
neared the left edge would have been worse than the problem.

The peek never writes the saved rail preference. Inside the editor
`forms.nav.collapsed` is neither read nor written, so whatever width was chosen
elsewhere is still there on the way out.

The collapse arrow renders on the editor route again, where before it was
absent from the DOM entirely. Hover is the way in for a mouse; the arrow is the
way in for the keyboard and for a touch device wide enough to get the desktop
rail instead of the drawer.
