---
'@quill/web': patch
---

Admin dropdown menus stay inside the screen, and stop resizing while you search.

The shared `Select` sizes its menu to its longest option and hangs it under the trigger. Three things went wrong with that:

- It flipped to open leftward whenever the right side was too small, without checking that the left side was any better. On a phone, the "Then" select in a question's logic dialog put more than half of its menu outside the dialog, much of it off-screen, and in the builder's 360px settings rail the menu was cut off at the rail's left edge. The menu now measures the room it really has, counting the window and every ancestor that clips it (a dialog body, a scrolling panel), flips only when it fits on the other side, and otherwise narrows to the room there is and lets long options wrap. It also follows a window resize while open.
- Its width followed the options left in the list, so in a searchable select it shrank and grew under the pointer as you typed. The width is now fixed when the menu opens.
- A long selected option could make the trigger itself wider than its slot when the select sat in a flex row, pushing it out of a dialog. The trigger now shrinks to its slot and truncates its label.

Keyboard behaviour, focus return and styling are unchanged. A browser-level spec (`pnpm qa:component`) mounts the real component with the app's compiled CSS and pins the menu's placement and width in Chromium and WebKit; it needs no server.
