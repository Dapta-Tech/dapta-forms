import {
  DM_Sans,
  Fraunces,
  Inter,
  Manrope,
  Playfair_Display,
  Poppins,
  Space_Grotesk,
  Work_Sans,
} from 'next/font/google';
import type { FormFont } from '@quill/engine';

/**
 * The curated typefaces a form author can choose from (`FORM_FONTS`).
 *
 * `next/font/google` resolves at BUILD time — it downloads each face and
 * self-hosts it — so the set has to be declared statically here. That is the
 * whole reason the product offers a curated list rather than "any Google font":
 * an arbitrary runtime family could only be loaded with a live request to a font
 * CDN from the public form, which puts a third-party dependency on a page meant
 * to run in a bare fork with nothing configured.
 *
 * `preload` is TRUE only for Poppins, the default. Every face is declared on
 * `<html>` so any form can use one without a re-render, but preloading all eight
 * would emit eight `<link rel="preload">` tags on every page for fonts that page
 * will never paint. The rest load on demand, when a glyph actually needs them.
 */
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
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
  poppins.variable,
  inter.variable,
  dmSans.variable,
  spaceGrotesk.variable,
  manrope.variable,
  workSans.variable,
  fraunces.variable,
  playfair.variable,
].join(' ');

/** The brand face, still the app-wide default (`--font-sans` in globals.css). */
export const brandFontVariable = poppins.variable;

const SANS_FALLBACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const SERIF_FALLBACK = 'ui-serif, Georgia, "Times New Roman", serif';

/**
 * The `font-family` value for each curated face. `custom` is absent on purpose:
 * its family name comes from the author's config, so the caller builds that
 * stack itself (see `formFontStack`).
 */
const CURATED_STACKS: Record<Exclude<FormFont, 'custom'>, string> = {
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
    return name ? `"${name.replace(/"/g, '')}", ${SANS_FALLBACK}` : CURATED_STACKS.poppins;
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
