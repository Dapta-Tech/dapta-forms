---
'@quill/shared': minor
'@quill/engine': minor
'@quill/db': patch
---

Retune the platform's default look, and make the light theme a real one.

**Tokens.** The accent now has three jobs and three values instead of one:
`--primary` is the FILL, `--primary-ink` the LETTERS, `--primary-edge` the LINES.
That third one is what the light theme was missing — the raw lime measures 1.27:1
on paper, so every border, focus ring and selected outline drawn with it was an
indicator nobody could see. `formThemeVars` now emits `--pf-primary-edge` for an
authored form too, clamped only when the author's colour would have been
invisible: a colour that already reads is passed through untouched, exactly like
`--pf-primary` itself.

`--faint` gains a real value on dark (it measured 4.28:1 on `--muted`, under AA
for the 10px it carries) and `--brand-ink` / `--brand-ink-foreground` arrive as
the one pair in the file that does NOT flip with the theme — a ground for fixed
colour third-party artwork, which cannot follow a scheme it does not know about.

The dark block is now `:root, [data-theme='dark']` rather than `:root` alone. One
declaration, no second copy, and it makes the palette re-establishable on a
SUBTREE: that is what lets a public form pin itself to the product default inside
an admin document that chose light.

**Engine.** `DEFAULT_FORM_FONT` moves to Figtree, and `FORM_FONTS` swaps `visby`
for `figtree`. The retired value never left an unpushed branch, so no stored
config references it. The list may only ever hold freely-redistributable faces —
`next/font` bakes every curated face into the build and therefore into the
repository, so a licensed commercial face cannot be a member of this union no
matter how well it reads.

**Db.** The seeded demo form's accent stops being stock Tailwind indigo. Its job
is to show that a form carries its OWNER's brand, and the colour nobody picked
made the largest saturated object on the builder screen look like an unstyled
default sitting next to our own Publish.
