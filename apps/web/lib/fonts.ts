import {
  DM_Sans,
  Fraunces,
  Inter,
  Manrope,
  Martian_Mono,
  Playfair_Display,
  Poppins,
  Space_Grotesk,
  Work_Sans,
} from 'next/font/google';
import localFont from 'next/font/local';
import type { FormFont } from '@quill/engine';

/**
 * The curated typefaces a form author can choose from (`FORM_FONTS`).
 *
 * `next/font` resolves at BUILD time — it self-hosts every face — so the set has
 * to be declared statically here. That is the whole reason the product offers a
 * curated list rather than "any Google font": an arbitrary runtime family could
 * only be loaded with a live request to a font CDN from the public form, which
 * puts a third-party dependency on a page meant to run in a bare fork with
 * nothing configured.
 *
 * `preload` is TRUE only for the two brand faces (Visby CF and Martian Mono),
 * which every page paints. Every other face is declared on `<html>` so any form
 * can use one without a re-render, but preloading all of them would emit a
 * `<link rel="preload">` per face on every page for fonts that page will never
 * paint. The rest load on demand, when a glyph actually needs them.
 */

/**
 * Visby CF — the brand face, and the voice that does all the talking.
 *
 * Local rather than `next/font/google` because it is a licensed commercial
 * typeface, not a Google-hosted one: the five weights in `assets/fonts/visby`
 * are subset to latin + latin-ext and converted to woff2 (~14 KB each). Only the
 * weights the type scale actually uses are declared — 400 body, 500 labels, 600
 * titles, 700 buttons, 800 display — because an unused weight is a file the
 * browser may still fetch. There are no obliques: this language has no italic
 * role, hierarchy comes from size and slate-vs-white.
 *
 * NOTE ON LICENSING: these binaries are redistributed by every clone of this
 * repository. Confirm the Visby CF license covers that before shipping, and if
 * it does not, drop the files and the fallback stack below degrades the page to a
 * system sans rather than breaking it.
 */
const visbyCF = localFont({
  src: [
    { path: '../assets/fonts/visby/visby-cf-400.woff2', weight: '400', style: 'normal' },
    { path: '../assets/fonts/visby/visby-cf-500.woff2', weight: '500', style: 'normal' },
    { path: '../assets/fonts/visby/visby-cf-600.woff2', weight: '600', style: 'normal' },
    { path: '../assets/fonts/visby/visby-cf-700.woff2', weight: '700', style: 'normal' },
    { path: '../assets/fonts/visby/visby-cf-800.woff2', weight: '800', style: 'normal' },
  ],
  variable: '--font-visby',
  display: 'swap',
});

/**
 * Martian Mono — the voice that does all the measuring.
 *
 * The second half of the two-voice system: telemetry labels, readouts, metric
 * values, codes and keys, always uppercase and tracked at 8–11px. It never sets
 * a sentence of prose. It is app chrome rather than a form-author choice, so it
 * is deliberately absent from `FORM_FONTS` — an author picks the voice their
 * questions speak in, not the voice the dashboard measures in.
 */
const martianMono = Martian_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-martian-mono',
  display: 'swap',
  // Not preloaded: it paints the `font-mono` spots (URLs, slugs, tokens, hex
  // values) rather than page furniture, so most routes never need it and the ones
  // that do can swap a few short strings.
  preload: false,
});

/** Poppins — the previous brand face. Still curated: forms already published
 *  with it must keep rendering in it, so it stays in `FORM_FONTS` and only loses
 *  its preload (it is no longer what a page paints by default). */
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
  preload: false,
});

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap', preload: false });
const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans', display: 'swap', preload: false });
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
  preload: false,
});
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', display: 'swap', preload: false });
const workSans = Work_Sans({ subsets: ['latin'], variable: '--font-work-sans', display: 'swap', preload: false });
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap', preload: false });
const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
  preload: false,
});

/** Every face's CSS variable, for the `<html>` element. */
export const fontVariables = [
  visbyCF.variable,
  martianMono.variable,
  poppins.variable,
  inter.variable,
  dmSans.variable,
  spaceGrotesk.variable,
  manrope.variable,
  workSans.variable,
  fraunces.variable,
  playfair.variable,
].join(' ');

/** The brand face, the app-wide default (`--font-sans` in globals.css). */
export const brandFontVariable = visbyCF.variable;

const SANS_FALLBACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const SERIF_FALLBACK = 'ui-serif, Georgia, "Times New Roman", serif';

/**
 * The `font-family` value for each curated face. `custom` is absent on purpose:
 * its family name comes from the author's config, so the caller builds that
 * stack itself (see `formFontStack`).
 */
const CURATED_STACKS: Record<Exclude<FormFont, 'custom'>, string> = {
  visby: `var(--font-visby), "Visby CF", ${SANS_FALLBACK}`,
  poppins: `var(--font-poppins), Poppins, ${SANS_FALLBACK}`,
  inter: `var(--font-inter), Inter, ${SANS_FALLBACK}`,
  'dm-sans': `var(--font-dm-sans), "DM Sans", ${SANS_FALLBACK}`,
  'space-grotesk': `var(--font-space-grotesk), "Space Grotesk", ${SANS_FALLBACK}`,
  manrope: `var(--font-manrope), Manrope, ${SANS_FALLBACK}`,
  'work-sans': `var(--font-work-sans), "Work Sans", ${SANS_FALLBACK}`,
  fraunces: `var(--font-fraunces), Fraunces, ${SERIF_FALLBACK}`,
  playfair: `var(--font-playfair), "Playfair Display", ${SERIF_FALLBACK}`,
};

/**
 * The CSS `font-family` a resolved design should render with.
 *
 * A custom face is quoted and given the same fallback chain as the curated ones,
 * so a font file that 404s degrades to a system sans rather than to an unstyled
 * serif. `resolveDesign` has already guaranteed that `custom` implies a complete
 * `customFont`, so there is no half-configured case to handle here.
 */
export function formFontStack(font: FormFont, customName?: string | null): string {
  if (font === 'custom') {
    const name = customName?.trim();
    return name ? `"${name.replace(/"/g, '')}", ${SANS_FALLBACK}` : CURATED_STACKS.visby;
  }
  return CURATED_STACKS[font];
}

/**
 * The `@font-face` rule for an author-supplied face, or null when there isn't
 * one. `font-display: swap` keeps the form readable while the file loads — a
 * form that renders invisible text until a third-party font arrives is worse
 * than one that reflows.
 */
export function customFontFace(name: string, url: string): string {
  // The family name is quoted and its own quotes stripped; the URL is quoted and
  // validated as http(s) by the schema. Both sinks are inside a CSS string, so
  // neither can terminate the rule and inject a new one.
  const family = name.replace(/["\\]/g, '');
  const src = url.replace(/["\\)]/g, '');
  return `@font-face{font-family:"${family}";src:url("${src}");font-display:swap;}`;
}
