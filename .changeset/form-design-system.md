---
'@quill/engine': minor
'@quill/shared': minor
'@quill/types': minor
---

A real design system for a form, replacing a single accent color.

`branding` gains fifteen optional axes — `background`, `foreground`,
`backgroundStyle`/`backgroundImage`/`backgroundOverlay`, `fontFamily` +
`customFont`, `radius`, `buttonStyle`, `buttonFullWidth`, `progressStyle`,
`logoSize`, `logoPosition`, `contentAlign`, `contentWidth`, `transition` — plus
`themePreset` (editor bookkeeping) and `ogImage`. Every one is optional and
resolves, when absent, to the look the renderer already had: `resolveDesign`
keeps that mapping in one frozen table (`LEGACY_FORM_DESIGN`) so no published
form changes appearance, pinned by tests.

`resolveDesign` and `designAttributes` (`@quill/engine/form-design`) are the
single answer to "what does this form look like", shared by the public renderer,
the live preview and the builder canvas. Two axes are cross-validated rather
than trusted: an `image` background with no usable URL falls back to `solid`,
and a `custom` typeface with an incomplete source falls back to the brand face,
so a combination that renders as a blank page cannot be reached even from a
hand-edited config.

**Colors are rendered exactly as chosen — nothing is corrected.** `formThemeVars`
paints the author's color everywhere, because a silently substituted color reads
as a bug: you set lime, the page shows olive, and nothing you click explains it.
Legibility is handled where the author can act on it, in the editor: risky pairs
are measured and warned about, with `suggestReadable` offering a readable
alternative in one click, and the decision stays theirs. The only derived value
left is the label ON a solid accent, since nobody picks the color of button text.

Nor is any text accent-coloured. Three rules used to be — the cover eyebrow, the
slider's value, and the dot after the form name — which meant a bright or pale
brand color silently erased whatever it was applied to. The accent is now only
ever a fill or a border, so the whole class of problem is gone rather than warned
about.

**Bug fixed in `@quill/shared`'s color math:** `clampAccent` took no background
and always lightened toward white, which was correct only because the public
form was always dark. On a light ground it pushed a pale color further into
unreadable and then reported it as safe. The corrected walk (ground-aware
direction) now lives in one place and backs both `clampAccent` and
`suggestReadable`. `accentWasAdjusted` is removed — the render path it served no
longer exists.

New: `suggestReadable`, `contrastRatio`, `contrastGrade`, `isLightColor`,
`readableOn`, `resolveThemeMode`, and `formThemeVars`, which derives the
supporting tokens (card, muted, border) by mixing the author's ground toward
their text — so an arbitrary background gets a coherent palette instead of a
fixed light or dark one.

Setting a background LOCKS the form's theme: it stops following the visitor's
light/dark preference. A page cannot honour both an author's chosen palette and
an OS setting without one of them being wrong, and the author is the one who saw
the result.
