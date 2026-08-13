# Share-card typefaces

The nine curated form faces (`FORM_FONTS` in `@quill/engine`, minus `custom`),
vendored as TrueType so `next/og` can rasterize the share card in the same
typeface the form itself is set in. Loaded by `apps/web/lib/og-fonts.ts`.

## Why a second copy

The app already self-hosts every one of these through `next/font/google`
(`apps/web/lib/fonts.ts`). That path cannot serve this one: it produces a CSS
`@font-face` plus a hashed `.woff2`, and Satori — the rasterizer behind
`next/og` — needs the font **binary**, in a format it can parse. It parses TTF,
OTF and WOFF. It does not parse WOFF2, which is the only thing `next/font`
emits.

So these are the same releases, in the one format that works, sitting next to
the code that reads them.

## Provenance

Downloaded from the Google Fonts CSS API with a legacy user agent, which is what
makes it answer with `format('truetype')` instead of WOFF2:

```bash
curl -H "User-Agent: Mozilla/4.0" \
  "https://fonts.googleapis.com/css?family=Figtree:400&subset=latin"
```

`latin`, the same subset `apps/web/lib/fonts.ts` asks `next/font` for. Matching it
is the point: the card is supposed to be the form at a glance, so it should have
exactly the glyph coverage the form has. A wider subset here would let a card
render a name the page it advertises renders as tofu, which is a stranger failure
than both of them missing the same glyph. (It was briefly `latin,latin-ext`, which
cost 364 KB to be *less* faithful.)

Two weights per family — 400 and 700. A share card has exactly two voices, and
every extra weight is bytes read on a request a social crawler is waiting on.

## License

Every family here is released under the **SIL Open Font License 1.1**, which is
what makes redistributing them inside this repository legal — the same
constraint that decides which faces may join `FORM_FONTS` at all (see the note
on `DEFAULT_FORM_FONT` in `packages/engine/src/form-design.ts`). Full text:
<https://openfontlicense.org>.

| family | designer(s) |
| --- | --- |
| Figtree | Erik Kennedy |
| Poppins | Indian Type Foundry, Jonny Pinhorn |
| Inter | Rasmus Andersson |
| DM Sans | Colophon Foundry, Jonny Pinhorn, Indian Type Foundry |
| Space Grotesk | Florian Karsten |
| Manrope | Mikhail Sharanda |
| Work Sans | Wei Huang |
| Fraunces | Undercase Type, Phaedra Charles, Flavia Zimbardi |
| Playfair Display | Claus Eggers Sørensen |

## Adding a face

Adding a value to `FORM_FONTS` without adding its files here is safe but silent:
`cardFonts()` falls back to the brand face, so the card renders in Figtree while
the form renders in the new face. Vendor both weights and add the entry to
`FONT_FILES` in the same change.
