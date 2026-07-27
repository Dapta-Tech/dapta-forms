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

**Behavioural fix in `@quill/shared`:** `clampAccent` took no background and
always lightened toward white, which was correct only because the public form
was always dark. On a light ground it "clamped" a pale accent further into
unreadable and then reported it as safe. It now takes the real background
(defaulting to the previous dark canvas, so existing call sites are unchanged)
and nudges away from that ground in whichever direction separates. Same for
`accentWasAdjusted` and `accentLabelContrast`.

The clamp is applied NARROWLY. `formThemeVars` paints `--pf-primary` with the
author's exact color wherever the accent is a fill — the progress bar, a solid
button, a selected option, borders, the glow — because a brand color is the
brand, and turning a client's lime into olive because the page went white is the
product overruling its author. The label on that fill is derived from the raw
color, so it stays legible without changing it. Only `--pf-primary-ink`, used by
the three places the accent is TEXT on the form ground (the cover badge, the
slider's value, the logo dot), is clamped — lime letters on a white page are not
a brand statement, they are unreadable.

New: `contrastRatio`,
`contrastGrade`, `isLightColor`, `readableOn`, `resolveThemeMode`, and
`formThemeVars`, which derives the supporting tokens (card, muted, border) by
mixing the author's ground toward their text — so an arbitrary background gets a
coherent palette instead of a fixed light or dark one.

Setting a background LOCKS the form's theme: it stops following the visitor's
light/dark preference. A page cannot honour both an author's chosen palette and
an OS setting without one of them being wrong, and the author is the one who saw
the result.
