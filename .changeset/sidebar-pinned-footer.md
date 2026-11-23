---
'@quill/web': patch
---

The left menu keeps its header and footer in place when the list is taller than
the window. Only the menu items scroll, between the wordmark and workspace
switcher at the top and the theme toggle and profile row at the bottom, in the
open rail, the rail collapsed to 64px and the mobile drawer. Before, the whole
sidebar scrolled: the profile row and the theme toggle went off the bottom, and
scrolling with the pointer over the menu left the wordmark row cut off at the
top of the window. Nothing changes when everything fits.
