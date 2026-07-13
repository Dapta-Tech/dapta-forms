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

const DARK_CANVAS_RGB: Rgb = { r: 0x22, g: 0x22, b: 0x22 };
const MIN_ACCENT_CONTRAST = 3;

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

/** Clamp a host-chosen accent to an AA-safe range (lighten toward white 0.12/step). */
export function clampAccent(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return DEFAULT_ACCENT;
  let current = rgb;
  for (let i = 0; i < 20 && contrast(current, DARK_CANVAS_RGB) < MIN_ACCENT_CONTRAST; i++) {
    current = mix(current, WHITE, 0.12);
  }
  return toHex(current);
}

/** The label color that reads on top of the accent (black or white). */
export function onAccent(hex: string): string {
  const rgb = parseHex(hex) ?? parseHex(DEFAULT_ACCENT)!;
  return contrast(rgb, BLACK) >= contrast(rgb, WHITE) ? '#1a1a1c' : '#fafafa';
}

export function accentLabelContrast(hex: string): number {
  const accent = parseHex(clampAccent(hex))!;
  const label = parseHex(onAccent(clampAccent(hex)))!;
  return Math.round(contrast(accent, label) * 10) / 10;
}

/** True when the host's raw pick had to be nudged lighter to stay readable. */
export function accentWasAdjusted(hex: string): boolean {
  const parsed = parseHex(hex);
  if (!parsed) return false;
  return toHex(parsed).toLowerCase() !== clampAccent(hex).toLowerCase();
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
