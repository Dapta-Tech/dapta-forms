---
"@quill/web": patch
---

Fixes found reviewing the dCal scheduler before merge.

The dCal mark rendered unmasked: its mask reference was written as a literal
string in a JSX attribute, so the swoosh overlapped the letterform on both
surfaces that draw it.

A dCal step no longer runs Calendly's code. An early return stops a render, not
an effect, so a dCal canvas was stapling Calendly's parameters onto a dCal URL
and injecting Calendly's widget script into the builder page, and a dCal panel
was fetching the Calendly event-type list that nothing rendered.

The workspace switcher now follows the author's own pick rather than whichever
workspace dCal called current, which could name one workspace while listing
another's events. The setup card's primary button is disabled when there is no
picker for it to open. A slow list read can no longer land on top of a newer
one. The iframe title comes from the catalog instead of a hardcoded string.
