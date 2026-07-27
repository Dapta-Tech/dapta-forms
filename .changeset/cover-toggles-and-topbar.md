---
'@quill/types': minor
'@quill/engine': minor
'@quill/shared': minor
---

Two new cover toggles, and an editor topbar that stops overflowing.

`cover.bannerScope` chooses where the promo banner renders — every screen (the
default, and what every existing config keeps doing) or the cover alone.
`cover.showClientLogos` switches the "trusted by" marquee off without deleting
the logos; only an explicit `false` hides it, so existing configs still show
theirs. Both are additive optional fields, resolved by the new pure helpers
`showBanner` and `showClientLogos`.

The editor topbar no longer wraps its controls onto a second line or pushes
Publish off-screen: the form-name input is now the bar's only elastic child,
and the tab labels, link labels and publish pill each reveal at the width where
they actually fit rather than all at once.
