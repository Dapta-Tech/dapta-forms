---
'@quill/shared': patch
---

An embedded form's redirect now leaves at the top level instead of inside the iframe.

A form that ends in a redirect used to assign `window.location.href`. Embedded
on someone else's site that navigates the FRAME, so the destination had to
survive being framed by a third party. Checkout pages refuse to: a Stripe
Payment Link answers "Stripe Checkout is not able to run in an iFrame" and hangs
on its own skeleton forever, so the visitor submitted the form and went nowhere.

All six redirect sites (immediate, delayed, and post-booking, in both the paged
and the vertical renderer) now go through `navigateTop`, which asks the host
page to navigate itself via `embed.js` and falls back to navigating the top
directly when no acknowledgement comes back. Exactly one of the two ever runs:
starting both races two navigations of the same document, and WebKit resolves
that race by cancelling both.

`embed.js` gained the matching handler. It is served with `max-age=0`, so an
embedded page picks it up on its next load with no change to the snippet. A host
still serving an older copy is covered by the direct fallback, as is a bare
iframe pasted with no script at all.

Framing is detected from the window, not from `?embed=1`, so an iframe pasted
without the flag is fixed too. Unframed forms are untouched: one
`window.location.href`, and nothing posted to anyone.
