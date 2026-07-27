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

/** DS primary lime — the default accent when a host hasn't chosen one. */
export const DEFAULT_ACCENT = '#cbe84f';

/**
 * The token ground (`--background`) a form renders on when its author has not
 * chosen one. Every contrast helper below defaults to this, which is why they
 * used to be correct without taking a background at all — the public form was
 * dark, always.
 */
export const DEFAULT_CANVAS = '#222222';

/** The foreground that pairs with `DEFAULT_CANVAS`. */
export const DEFAULT_CANVAS_FOREGROUND = '#eeeeee';

const DARK_CANVAS_RGB: Rgb = { r: 0x22, g: 0x22, b: 0x22 };
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

/** The near-black or near-white text that reads on an arbitrary ground. */
export function readableOn(background: string): string {
  return isLightColor(background) ? '#1a1a1c' : '#fafafa';
}

/**
 * Clamp a host-chosen accent until it separates from the ground it sits on.
 *
 * The nudge direction is derived from the GROUND, not fixed: on a dark canvas a
 * too-dark accent is lightened toward white, on a light canvas a too-light
 * accent is darkened toward black. Before per-form backgrounds existed this
 * always mixed toward white, which was right only because the public form was
 * always dark — on a white page that same code would have declared an
 * unreadable pastel "safe".
 */
export function clampAccent(hex: string, background: string = DEFAULT_CANVAS): string {
  const rgb = parseHex(hex);
  if (!rgb) return DEFAULT_ACCENT;
  const ground = parseHex(background) ?? DARK_CANVAS_RGB;
  const target = luminance(ground) > 0.5 ? BLACK : WHITE;
  let current = rgb;
  for (let i = 0; i < 20 && contrast(current, ground) < MIN_ACCENT_CONTRAST; i++) {
    current = mix(current, target, 0.12);
  }
  return toHex(current);
}

/** The label color that reads on top of the accent (black or white). */
export function onAccent(hex: string): string {
  const rgb = parseHex(hex) ?? parseHex(DEFAULT_ACCENT)!;
  return contrast(rgb, BLACK) >= contrast(rgb, WHITE) ? '#1a1a1c' : '#fafafa';
}

export function accentLabelContrast(hex: string, background: string = DEFAULT_CANVAS): number {
  const clamped = clampAccent(hex, background);
  const accent = parseHex(clamped)!;
  const label = parseHex(onAccent(clamped))!;
  return Math.round(contrast(accent, label) * 10) / 10;
}

/** True when the host's raw pick had to be nudged to stay readable on its ground. */
export function accentWasAdjusted(hex: string, background: string = DEFAULT_CANVAS): boolean {
  const parsed = parseHex(hex);
  if (!parsed) return false;
  return toHex(parsed).toLowerCase() !== clampAccent(hex, background).toLowerCase();
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
  const target = luminance(ground) > 0.5 ? BLACK : WHITE;
  let current = rgb;
  for (let i = 0; i < 24 && contrast(current, ground) < minRatio; i++) {
    current = mix(current, target, 0.08);
  }
  const out = toHex(current);
  return out.toLowerCase() === toHex(rgb).toLowerCase() ? null : out;
}
