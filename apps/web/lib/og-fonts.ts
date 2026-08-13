import { readFileSync } from 'node:fs';
import { DEFAULT_FORM_FONT, type FormFont } from '@quill/engine';

/**
 * The typefaces the share card can be SET IN, as raw font files.
 *
 * `next/font` cannot serve this surface even though it already self-hosts every
 * one of these faces: it resolves to a CSS `@font-face` and a hashed `.woff2`,
 * and `next/og` needs the font BINARY handed to it — in a format Satori can
 * parse, which woff2 is not. So the same nine families are vendored here a
 * second time as TrueType. They are the identical Google Fonts releases under
 * the same OFL that lets `next/font` bake them into the build (see
 * `assets/fonts/README.md`), so this adds no license surface, only bytes.
 *
 * Two weights per family, not the full axis: a share card has exactly two voices,
 * a 700 headline and a 400 supporting line. Loading more would cost request time
 * for glyphs the card cannot draw.
 *
 * The paths are written out as literal `new URL(…, import.meta.url)` rather than
 * built from the family key. That form is what the bundler can see, so the file
 * is traced into the standalone output; a template string would leave the route
 * reading a path that does not exist in the deployed image.
 */
type CuratedFont = Exclude<FormFont, 'custom'>;

const FONT_FILES: Record<CuratedFont, { regular: URL; bold: URL }> = {
  figtree: {
    regular: new URL('../assets/fonts/figtree-400.ttf', import.meta.url),
    bold: new URL('../assets/fonts/figtree-700.ttf', import.meta.url),
  },
  poppins: {
    regular: new URL('../assets/fonts/poppins-400.ttf', import.meta.url),
    bold: new URL('../assets/fonts/poppins-700.ttf', import.meta.url),
  },
  inter: {
    regular: new URL('../assets/fonts/inter-400.ttf', import.meta.url),
    bold: new URL('../assets/fonts/inter-700.ttf', import.meta.url),
  },
  'dm-sans': {
    regular: new URL('../assets/fonts/dm-sans-400.ttf', import.meta.url),
    bold: new URL('../assets/fonts/dm-sans-700.ttf', import.meta.url),
  },
  'space-grotesk': {
    regular: new URL('../assets/fonts/space-grotesk-400.ttf', import.meta.url),
    bold: new URL('../assets/fonts/space-grotesk-700.ttf', import.meta.url),
  },
  manrope: {
    regular: new URL('../assets/fonts/manrope-400.ttf', import.meta.url),
    bold: new URL('../assets/fonts/manrope-700.ttf', import.meta.url),
  },
  'work-sans': {
    regular: new URL('../assets/fonts/work-sans-400.ttf', import.meta.url),
    bold: new URL('../assets/fonts/work-sans-700.ttf', import.meta.url),
  },
  fraunces: {
    regular: new URL('../assets/fonts/fraunces-400.ttf', import.meta.url),
    bold: new URL('../assets/fonts/fraunces-700.ttf', import.meta.url),
  },
  playfair: {
    regular: new URL('../assets/fonts/playfair-400.ttf', import.meta.url),
    bold: new URL('../assets/fonts/playfair-700.ttf', import.meta.url),
  },
};

/** One `next/og` font entry. Named `Card` so the JSX never spells a family out. */
export interface OgFont {
  name: 'Card';
  data: Buffer;
  weight: 400 | 700;
  style: 'normal';
}

// Read once per process, not per card: the files are static and a social crawler
// can ask for several cards in a burst.
const cache = new Map<CuratedFont, OgFont[]>();

/**
 * The two font entries a card is drawn with.
 *
 * `custom` resolves to the default face rather than to the author's file. Their
 * face is a URL to somewhere we do not control, in a format (usually woff2) that
 * Satori cannot read, fetched while a crawler waits — the form itself can afford
 * that with `font-display: swap`, an image cannot. An unknown key lands here too,
 * so a face added to the union before its files are vendored degrades to the
 * brand face instead of rendering a card with no glyphs at all.
 */
export function cardFonts(font: FormFont): OgFont[] {
  const key: CuratedFont = font in FONT_FILES ? (font as CuratedFont) : (DEFAULT_FORM_FONT as CuratedFont);
  const hit = cache.get(key);
  if (hit) return hit;
  const files = FONT_FILES[key];
  const fonts: OgFont[] = [
    { name: 'Card', data: readFileSync(files.regular), weight: 400, style: 'normal' },
    { name: 'Card', data: readFileSync(files.bold), weight: 700, style: 'normal' },
  ];
  cache.set(key, fonts);
  return fonts;
}
