---
'@quill/engine': minor
'@quill/types': minor
'@quill/shared': minor
---

Forms can render the attribution badge at a smaller size, chosen in the Design panel. Existing forms are unchanged.

The "Made with" pill is fixed at one size on every public surface, and on a form
run as a paid-traffic landing page it is the loudest thing on screen that is not
the author's own brand. Design now offers it as an axis, `badgeSize`, beside the
logo controls: two values, Small and Medium.

Two values rather than three. `logoSize` carries a Large because the host's own
logo is the point of the page; nobody has asked for the attribution to be bigger
than it already is, and every value is CSS plus a toggle segment forever.

Medium is the default and is the size the pill has always rendered at, so an
absent value resolves to the exact pixels a published form already shows. That
is the same additive-config rule every other design axis follows.

Small shrinks the pill AND the wrapper around it. Shrinking the pill alone would
leave the space it used to fill, and the resulting hole reads worse than the
larger badge did. The wrapper has four context-dependent paddings (the base, the
cover footer, the one-page layout, and the wide band where the pill attaches
under the centred card), and all four come down together.

The badge needs no new props: the design attributes are stamped on the form root
and the pill is a descendant of it on all five of its call sites, so the live
preview and the public page pick the size up at once. The builder canvas is not
one of them, because it never draws the badge at all.

It stays a per-form setting rather than joining the workspace brand kit, which
carries identity (logo, colors, type, shape) and deliberately excludes every
size token.
