---
'@quill/shared': minor
---

Draw the share card in the form's own design — and fix the card that was never drawing the form at all.

Every form on the platform was unfurling as the same image: a near-black
rectangle with the word "Form" on it. The route reads `params` — which is a
Promise in this major — synchronously, so `accountCode` and `slug` were both
`undefined`, the lookup went to `/v1/public/forms/undefined/undefined`, took the
404, and rendered the "no form" fallback. Nothing about it was a colour bug: the
card had simply never seen a form. `generateMetadata` on the same page awaits its
params, which is why the unfurl's title was right while its image was not.

With the form actually in hand, the card is now generated from that form's own
design rather than from a two-colour approximation of it — the palette and its
whole derived surface ladder, the typeface, the corner radius, the button style,
the background treatment, the logo and its placement, the content alignment, and
the progress signal, all read through the same `resolveDesign` and
`@quill/shared` colour helpers the page itself renders with. A form that turned
progress off does not get a progress bar on its card; a form with square corners
gets a square card. A form that set no branding is drawn on the product's own
console palette, the same call `formDesignProps` already makes when it pins an
unbranded form to the dark theme.

The author's logo is drawn only when the author also chose the background. A logo
is artwork with a fixed colour and no idea what is behind it; on a ground the
author picked, that pairing is one they have seen, and on the product console it
is a coin flip a URL cannot settle. Backing it with a white plate was worse than
omitting it — `dapta-mark.png` is white artwork (mean luminance of its opaque
pixels: 236/255), so the plate meant to rescue a dark logo erased a light one.
Without one the Dapta Forms mark takes the rail instead.

Two things Satori cannot do are handled rather than hoped for. It reads no WebP —
the format most CMSs now serve — so an author's logo is fetched, type-checked and
dropped when undecodable, with a timeout, a size cap and a private-address refusal
around a fetch that is now server-side. And it needs font binaries in a format
`next/font` does not emit, so the nine curated faces are vendored as TrueType
under the same OFL that already lets the build redistribute them.

Adds `growth.shareCardSteps` and `growth.shareCardUntitled` to the message
catalog in both locales.
