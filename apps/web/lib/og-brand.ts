import { readFileSync } from 'node:fs';

/**
 * The Dapta Forms mark, as a `data:` URI the card can draw.
 *
 * Reads the same two SVGs the app ships in `public/` rather than a copy, so the
 * mark on a share card cannot drift from the mark in the product. The pair is
 * the light/dark artwork, not a themed `currentColor` drawing: the wordmark is
 * `#1a1a1c` in one file and `#fefefe` in the other, and the lime dot is fixed in
 * both. Picking the wrong one paints the mark into the ground it sits on.
 *
 * Satori reads SVG happily — unlike WebP, which is why the author's own logo
 * needs `og-remote-image.ts` and this does not.
 */
const MARK_FILES = {
  // For a card whose ground is dark: white wordmark.
  dark: new URL('../public/forms_logo_dark_mode.svg', import.meta.url),
  // For a card on paper: near-black wordmark.
  light: new URL('../public/forms_logo.svg', import.meta.url),
} as const;

/** The lockup's intrinsic proportions, from its `viewBox`. */
export const DAPTA_FORMS_MARK_RATIO = 5686 / 1040;

const cache = new Map<keyof typeof MARK_FILES, string>();

export function daptaFormsMark(isDark: boolean): string {
  const key = isDark ? 'dark' : 'light';
  const hit = cache.get(key);
  if (hit) return hit;
  const svg = readFileSync(MARK_FILES[key], 'utf8');
  const uri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  cache.set(key, uri);
  return uri;
}
