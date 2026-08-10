---
'@quill/types': minor
'@quill/engine': minor
'@quill/shared': minor
---

An authorable promo banner, a reveal screen with a look, and client logos that
can leave the cover.

`cover.bannerColor`, `cover.bannerTextColor` and `cover.bannerSize` give the
promo strip a fill, a text colour and one of three heights. Absent on any axis
keeps the derived tint and padding the stylesheet has always applied.

`formRevealSchema` gains a presentation: `loader` picks the animation
(`spinner` — the default and the existing look — `bar`, `versus`, or `none`),
`loaderSize` and `textSize` scale the mark and the copy across four steps,
`accentBackground` floods the screen with the form's accent, and
`versusYouLabel` / `versusMatchLabel` / `versusStatusLabel` name the two sides
of the `versus` layout and the live status under the match. The new pure helper
`resolveRevealPresentation` owns the defaults so the builder canvas and the
public renderer cannot disagree about them. The `md` mark is pinned to the size
this screen has always drawn, so an unconfigured reveal — and every form's
submitting screen, which shares the same spinner — is unchanged.

`cover.clientLogosScope` chooses where the "trusted by" marquee renders: the
cover (absent — every existing config, and the only place it has ever shown),
the reveal interstitial, or both. Resolved by the new pure helper
`showClientLogosOn`, which keeps the existing `showClientLogos` master switch
deciding first.

**Behaviour change:** the one-page (`vertical`) layout now honours
`cover.showClientLogos`. It previously ignored the toggle entirely, so a stored
config with `layout: 'vertical'` and `showClientLogos: false` was still showing
its marquee; after this it is hidden, as the slides layout already did.

`@quill/shared` also exports `blendHex`, the TS twin of CSS `color-mix`, so the
editor can run a contrast readout against a surface the stylesheet derives
rather than stores.
