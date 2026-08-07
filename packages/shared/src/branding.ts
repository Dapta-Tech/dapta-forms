/**
 * Branding helpers (ported from the platform's R25 accent engine). Forms keeps
 * the color core — AA-clamped accent + label contrast + CSS vars + monogram —
 * for Phase 1's per-form branding (`branding.primaryColor`).
 */

// --- The 9 style axes (exact unions) --------------------------------------

export interface PublicBranding {
  displayName: string | null;
  avatarUrl: string | null;
  /** The single accent color (AA-clamped on render). */
  brandColor: string | null;
}

/**
 * Program Lime — the default accent when a host hasn't chosen one.
 *
 * The hex form of the token scale's `hsl(68 76% 61%)`. It is written out rather
 * than computed because every helper in this file is hex-in/hex-out contrast
 * math; the channels live in `tokens.css`, and these two must be kept in step.
 */
export const DEFAULT_ACCENT = '#d3e750';

/**
 * The token ground (`--background`) a form renders on when its author has not
 * chosen one. Every contrast helper below defaults to this, which is why they
 * used to be correct without taking a background at all — the public form was
 * dark, always.
 */
export const DEFAULT_CANVAS = '#0a0c0e';

/** The foreground that pairs with `DEFAULT_CANVAS` — Signal White, never pure. */
export const DEFAULT_CANVAS_FOREGROUND = '#e8edf2';

const DARK_CANVAS_RGB: Rgb = { r: 0x0a, g: 0x0c, b: 0x0e };
const MIN_ACCENT_CONTRAST = 3;
/** WCAG AA for normal-size body text. */
export const AA_CONTRAST = 4.5;
/** WCAG AAA for normal-size body text. */
export const AAA_CONTRAST = 7;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(hex: string): Rgb | null {
  const clean = hex.trim().replace(/^#/, '');
  const full = clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function toHex(rgb: Rgb): string {
  const part = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}

function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function mix(rgb: Rgb, target: Rgb, amount: number): Rgb {
  return {
    r: rgb.r + (target.r - rgb.r) * amount,
    g: rgb.g + (target.g - rgb.g) * amount,
    b: rgb.b + (target.b - rgb.b) * amount,
  };
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/** True when a color is light enough that dark text belongs on top of it. */
export function isLightColor(hex: string): boolean {
  const rgb = parseHex(hex);
  if (!rgb) return false;
  return luminance(rgb) > 0.4;
}

/**
 * Which of the two token grounds a chosen background is — the form's LOCKED
 * theme. Choosing a background necessarily stops the form following the
 * visitor's light/dark preference: a page cannot honour both an author's
 * palette and an OS setting without one of them being wrong, and the author is
 * the one who saw the result. Absent a background, the form keeps inheriting.
 */
export function resolveThemeMode(background: string | null | undefined): 'light' | 'dark' | null {
  if (!background) return null;
  return isLightColor(background) ? 'light' : 'dark';
}

/**
 * The WCAG contrast ratio between two colors, rounded to one decimal. Exposed so
 * the editor can show a live AA/AAA readout: once an author can pick any
 * background and any text color, telling them when the pair is unreadable is
 * part of the feature, not a nicety.
 */
export function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return 0;
  return Math.round(contrast(ca, cb) * 10) / 10;
}

/** `AAA` / `AA` / `fail` for normal body text at the given ratio. */
export function contrastGrade(ratio: number): 'AAA' | 'AA' | 'fail' {
  if (ratio >= AAA_CONTRAST) return 'AAA';
  if (ratio >= AA_CONTRAST) return 'AA';
  return 'fail';
}

/**
 * The near-black or near-white text that reads on an arbitrary ground.
 *
 * Both ends are the token scale's own text colors rather than `#000`/`#fff`:
 * Bezel Graphite on light, Signal White on dark. Pure white on a dark ground is
 * the glare this palette exists to avoid, and an author's custom background
 * should still land them inside the system.
 */
export function readableOn(background: string): string {
  return isLightColor(background) ? '#0d1013' : '#e8edf2';
}

/**
 * Walk a color away from its ground until it clears `minRatio`.
 *
 * The direction is derived from the GROUND, not fixed: on a dark canvas a
 * too-dark color is lightened toward white, on a light canvas a too-light color
 * is darkened toward black. Before per-form backgrounds existed this always
 * mixed toward white, which was right only because the public form was always
 * dark — on a white page that same code pushed a pale accent further into
 * unreadable and then reported it as safe.
 */
function nudgeUntilReadable(rgb: Rgb, ground: Rgb, minRatio: number, step: number): Rgb {
  const target = luminance(ground) > 0.5 ? BLACK : WHITE;
  let current = rgb;
  for (let i = 0; i < 24 && contrast(current, ground) < minRatio; i++) {
    current = mix(current, target, step);
  }
  return current;
}

/**
 * Clamp a color until it separates from the ground it sits on.
 *
 * NOTE: nothing on the public form calls this any more — a chosen color is
 * rendered exactly as chosen (see `formThemeVars`). It survives as the shared
 * math behind `suggestReadable`, which offers the same result as advice rather
 * than applying it silently.
 */
export function clampAccent(hex: string, background: string = DEFAULT_CANVAS): string {
  const rgb = parseHex(hex);
  if (!rgb) return DEFAULT_ACCENT;
  const ground = parseHex(background) ?? DARK_CANVAS_RGB;
  return toHex(nudgeUntilReadable(rgb, ground, MIN_ACCENT_CONTRAST, 0.12));
}

/**
 * The label color that reads on top of the accent.
 *
 * Picks the better END first — Lime Ink, the one text color the palette permits on
 * Program Lime, or Signal White — and then WALKS IT until it clears AA.
 *
 * The walk is the point. Choosing between two fixed constants silently ships
 * failing pairs for any accent of middling luminance: the seeded demo form's
 * `#6366f1` put Lime Ink at 4.35:1, under the 4.5:1 its 14px/600 label needs, and
 * neither constant could have cleared it (white lands at 4.56:1 on that same
 * indigo — a coin flip, not a solution). Nobody picks the color of button text, so
 * the renderer owes it a guarantee rather than a best-of-two.
 */
export function onAccent(hex: string): string {
  const rgb = parseHex(hex) ?? parseHex(DEFAULT_ACCENT)!;
  const wantsDarkInk = contrast(rgb, BLACK) >= contrast(rgb, WHITE);
  const ink = wantsDarkInk ? '#0c0e07' : '#e8edf2';
  let current = parseHex(ink)!;
  if (contrast(current, rgb) >= AA_CONTRAST) return ink;

  // Push the ink toward the extreme of the end already chosen — a dark ink toward
  // black, a light one toward white — in the fine steps `suggestReadable` uses, so
  // the result stays as close to the palette's own ink as it can.
  //
  // NOT `nudgeUntilReadable`: that helper derives its direction from the GROUND
  // (toward white on a dark ground), which is right when the thing being moved is
  // an accent on a page. Here the thing being moved is the ink and the ground is
  // the accent, so on a mid-dark accent it would walk the near-black ink up through
  // the greys — straight through the lowest-contrast region — before improving.
  const target = wantsDarkInk ? BLACK : WHITE;
  for (let i = 0; i < 24 && contrast(current, rgb) < AA_CONTRAST; i++) {
    current = mix(current, target, 0.12);
  }
  return toHex(current);
}

export function accentLabelContrast(hex: string, background: string = DEFAULT_CANVAS): number {
  const clamped = clampAccent(hex, background);
  const accent = parseHex(clamped)!;
  const label = parseHex(onAccent(clamped))!;
  return Math.round(contrast(accent, label) * 10) / 10;
}

export function accentVars(rawAccent: string): Record<string, string> {
  const accent = clampAccent(rawAccent);
  return {
    '--accent': accent,
    '--accent-contrast': onAccent(accent),
    '--accent-hover': toHex(mix(parseHex(accent)!, WHITE, 0.16)),
    '--accent-soft': `color-mix(in srgb, ${accent} 16%, transparent)`,
    '--accent-wash': `color-mix(in srgb, ${accent} 22%, var(--bg-app))`,
  };
}

export function monogram(name: string): string {
  return (name.trim().charAt(0) || '?').toUpperCase();
}

// ---------------------------------------------------------------------------
// Per-form theme
// ---------------------------------------------------------------------------

/** The colors an author can set. Everything else is derived from them. */
export interface FormThemeColors {
  background?: string | null;
  foreground?: string | null;
  primaryColor?: string | null;
}

/**
 * The CSS custom properties a form's `.pf` root carries.
 *
 * The supporting tokens — card, muted, border, popover — are DERIVED from the
 * author's own two colors by mixing the ground toward the text, rather than
 * taken from a fixed light or dark palette. That is what makes an arbitrary
 * background work: mixing toward the foreground lightens surfaces on a dark
 * ground and darkens them on a light one, automatically, with no branch. A
 * fixed palette would give a warm cream background pure-white cards.
 *
 * Returns an EMPTY object when the author set no colors, so a form that never
 * touched the design tab inherits the shared tokens exactly as before —
 * the difference between "inherits" and "locked" is the presence of keys here.
 */
export function formThemeVars(colors: FormThemeColors): Record<string, string> {
  const vars: Record<string, string> = {};
  const background = colors.background?.trim() || null;
  const foreground = colors.foreground?.trim() || (background ? readableOn(background) : null);

  if (background && foreground) {
    const toward = (pct: number): string => `color-mix(in srgb, ${foreground} ${pct}%, ${background})`;
    vars['--background'] = background;
    vars['--foreground'] = foreground;
    vars['--card'] = toward(4);
    vars['--popover'] = toward(6);
    vars['--muted'] = toward(8);
    vars['--accent'] = toward(8);
    vars['--accent-foreground'] = foreground;
    vars['--card-foreground'] = foreground;
    vars['--popover-foreground'] = foreground;
    vars['--border'] = toward(16);
    vars['--input'] = toward(16);
    // Deliberately NOT color-mix: `--muted-foreground` is real body text, and
    // it has to stay legible rather than merely tinted, so it keeps 55% of the
    // foreground's own value against the ground.
    vars['--muted-foreground'] = `color-mix(in srgb, ${foreground} 62%, ${background})`;
  }

  if (colors.primaryColor) {
    const raw = colors.primaryColor.trim();

    // The author's color is painted EXACTLY as chosen, everywhere, with no
    // contrast correction. Silently substituting a color the author did not pick
    // reads as a bug — you set lime, the page shows olive, and nothing you click
    // explains it. Legibility is handled where it belongs: the editor measures
    // every risky pair and warns, with a one-click readable alternative, and the
    // decision stays the author's (see `suggestReadable`).
    vars['--pf-primary'] = raw;
    // The label ON that fill is still chosen for contrast, because it is the
    // renderer's own decision rather than an override of the author's — nobody
    // picks the color of button text.
    vars['--pf-primary-contrast'] = onAccent(raw);
    vars['--ring'] = `color-mix(in srgb, ${raw} 45%, transparent)`;
  }

  return vars;
}

/**
 * A readable version of `color` on `background`, or null when it already reads.
 *
 * This is `clampAccent`'s math offered as a SUGGESTION rather than applied
 * silently: the editor shows it beside the warning so an author can take it in
 * one click, or ignore it and publish the color they wanted.
 */
export function suggestReadable(
  color: string,
  background: string,
  minRatio: number = MIN_ACCENT_CONTRAST,
): string | null {
  const rgb = parseHex(color);
  const ground = parseHex(background);
  if (!rgb || !ground) return null;
  if (contrast(rgb, ground) >= minRatio) return null;
  // A finer step than `clampAccent`'s: this result is shown to a human as "use
  // this instead", so it should stop as close to their color as it can.
  const out = toHex(nudgeUntilReadable(rgb, ground, minRatio, 0.08));
  return out.toLowerCase() === toHex(rgb).toLowerCase() ? null : out;
}
