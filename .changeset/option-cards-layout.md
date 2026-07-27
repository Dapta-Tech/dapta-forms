---
'@quill/types': minor
'@quill/engine': minor
'@quill/shared': minor
---

Choice questions can now render their options as a card grid, on purpose.

The grid already existed but was reachable only through `showIcons`, a flag no
editor control ever set — so in practice only the seeded demo form had it. It is
now `optionLayout: 'list' | 'cards'`, chosen from a "Show options as" toggle on
the question. `showIcons` is deprecated and still read as the fallback by the new
`resolveOptionLayout`, so a config saved before this keeps its grid.

Each option's `icon` may be an emoji or an image URL, and the two are rendered
differently rather than identically: `isImageIcon` tells them apart, a glyph
centres in a circle, and an image gets a rectangle it letterboxes into with
`object-fit: contain` — so a wide logo is no longer cropped to its middle by a
circular mask. A broken image URL falls back to the glyph treatment instead of a
torn-image box. The icon cap grew from 64 to 512 characters to fit a real CDN
URL, and any icon that looks like an image must also pass `isSafeImageUrl`.

Uploading an image is not part of this — icons are an emoji or a URL, matching
how the form logo and client logos already work.
