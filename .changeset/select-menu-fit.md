---
'@quill/web': patch
---

Admin dropdown menus stay inside the screen, stop resizing while you search, and no longer take a dialog down with them on Escape.

The shared `Select` sizes its menu to its longest option and hangs it under the trigger. Several things went wrong with that:

- It flipped to open leftward whenever the right side was too small, without checking that the left side was any better. On a phone, the "Then" select in a question's logic dialog put more than half of its menu outside the dialog, much of it off-screen, and in the builder's 360px settings rail the menu was cut off at the rail's left edge. The menu now measures the room it really has, counting the window and every ancestor that clips it (a dialog body, a scrolling panel), flips only when it fits on the other side, and otherwise narrows to the room there is and lets long options wrap. It keeps doing so while open: when the window is resized, and when the panel or dialog around it changes size on its own.
- Its width followed the options left in the list, so in a searchable select it shrank and grew under the pointer as you typed. The width now follows the whole option list and nothing else: typing never changes it, and options that arrive while the menu is open (a list that finishes loading) widen it once.
- A long selected option could make the trigger itself wider than its slot when the select sat in a flex row or a `1fr` grid column, pushing it out of a dialog or squeezing the control next to it. The trigger now shrinks to its slot and truncates its label, and a truncated label carries its full text as a tooltip.
- Escape with a menu open closed the menu and the dialog around it in one keypress. It now closes the menu and returns focus to the trigger; a second Escape closes the dialog.

Arrow keys, Enter, Space, type-to-search and the styling are unchanged. The placement rules are unit-tested, and a browser-level spec (`pnpm qa:component`) mounts the real component with the app's compiled CSS and pins the menu's placement and width in Chromium and WebKit; it needs no server.
