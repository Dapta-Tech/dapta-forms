/**
 * Booking-page branding engine (ported verbatim from the original R25 util).
 * The host picks ONE accent color; we clamp it to an AA-safe range and derive
 * everything else. The public page and the studio live-preview share these, so
 * preview == production. The 9 style axes + 4 theme presets are the exact values
 * from the previous version — radii/spacing/font stacks must match.
 */

// --- The 9 style axes (exact unions) --------------------------------------
export type BookingPageTemplate = 'classic' | 'split' | 'banded';
export type BookingCardStyle = 'outline' | 'elevated' | 'filled';
export type BookingCorners = 'sharp' | 'soft' | 'round';
export type BookingButtons = 'rounded' | 'pill' | 'square';
export type BookingDensity = 'comfortable' | 'compact';
export type BookingFont = 'sans' | 'rounded' | 'serif';
export type BookingSlotLayout = 'grid' | 'list';
export type BookingDayGroup = 'flat' | 'boxed';
export type BookingSlotSelect = 'soft' | 'solid';

export interface PublicBranding {
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  accentColor: string;
  template: BookingPageTemplate;
  landingEnabled: boolean;
  defaultEventSlug: string | null;
  cardStyle: BookingCardStyle;
  corners: BookingCorners;
  buttons: BookingButtons;
  density: BookingDensity;
  font: BookingFont;
  slotLayout: BookingSlotLayout;
  dayGroup: BookingDayGroup;
  slotSelect: BookingSlotSelect;
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

// --- The 9 axis value maps (exact radii/spacing/font stacks) ---------------
export const DEFAULT_CARD_STYLE: BookingCardStyle = 'outline';
export const DEFAULT_CORNERS: BookingCorners = 'soft';
export const DEFAULT_BUTTONS: BookingButtons = 'rounded';
export const DEFAULT_DENSITY: BookingDensity = 'comfortable';
export const DEFAULT_FONT: BookingFont = 'sans';
export const DEFAULT_SLOT_LAYOUT: BookingSlotLayout = 'grid';
export const DEFAULT_DAY_GROUP: BookingDayGroup = 'flat';
export const DEFAULT_SLOT_SELECT: BookingSlotSelect = 'soft';

const CORNER_RADII: Record<BookingCorners, { card: string; sm: string }> = {
  sharp: { card: '4px', sm: '3px' },
  soft: { card: '16px', sm: '8px' },
  round: { card: '28px', sm: '16px' },
};

const BUTTON_RADII: Record<BookingButtons, string> = {
  rounded: '8px',
  pill: '999px',
  square: '2px',
};

const DENSITY_SPACE: Record<BookingDensity, { pad: string; gap: string; slotPad: string }> = {
  comfortable: { pad: '20px', gap: '12px', slotPad: '12px' },
  compact: { pad: '12px', gap: '8px', slotPad: '8px' },
};

const FONT_STACKS: Record<BookingFont, { display: string; body: string }> = {
  sans: {
    display: 'var(--font-display, Poppins, ui-sans-serif, system-ui, sans-serif)',
    body: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
  },
  rounded: {
    display: '"SF Pro Rounded", ui-rounded, "Segoe UI", system-ui, sans-serif',
    body: '"SF Pro Rounded", ui-rounded, "Segoe UI", system-ui, sans-serif',
  },
  serif: {
    display: 'Georgia, "Times New Roman", ui-serif, serif',
    body: 'Georgia, "Times New Roman", ui-serif, serif',
  },
};

type WidgetAxes = Pick<PublicBranding, 'corners' | 'density' | 'font' | 'buttons'>;

export function widgetStyleVars(b: Partial<WidgetAxes>): Record<string, string> {
  const corners = CORNER_RADII[b.corners ?? DEFAULT_CORNERS];
  const density = DENSITY_SPACE[b.density ?? DEFAULT_DENSITY];
  const font = FONT_STACKS[b.font ?? DEFAULT_FONT];
  return {
    '--bp-radius': corners.card,
    '--bp-radius-sm': corners.sm,
    '--bp-btn-radius': BUTTON_RADII[b.buttons ?? DEFAULT_BUTTONS],
    '--bp-pad': density.pad,
    '--bp-gap': density.gap,
    '--bp-slot-pad': density.slotPad,
    '--bp-font-display': font.display,
    '--bp-font-body': font.body,
  };
}

export function brandingStyleVars(b: PublicBranding): Record<string, string> {
  return { ...accentVars(b.accentColor), ...widgetStyleVars(b) };
}

export function brandingClass(b: PublicBranding): string {
  return brandingClassOf(b);
}

/**
 * Emit the host-class list from just the (possibly partial) style axes — the
 * bridge that makes the 5 class-driven axes reach the DOM. Pair with the
 * `.branded-surface` CSS. `template`/`cardStyle`/`slotLayout`/`dayGroup`/
 * `slotSelect` render via these classes; `corners`/`buttons`/`density`/`font`
 * render via the `--bp-*` custom properties (widgetStyleVars).
 */
export function brandingClassOf(
  axes: Partial<
    Pick<PublicBranding, 'template' | 'cardStyle' | 'slotLayout' | 'dayGroup' | 'slotSelect'>
  >,
): string {
  return [
    'branded-surface',
    `tpl-${axes.template ?? 'classic'}`,
    `card-${axes.cardStyle ?? DEFAULT_CARD_STYLE}`,
    `slots-${axes.slotLayout ?? DEFAULT_SLOT_LAYOUT}`,
    `day-${axes.dayGroup ?? DEFAULT_DAY_GROUP}`,
    `sel-${axes.slotSelect ?? DEFAULT_SLOT_SELECT}`,
  ].join(' ');
}

export function defaultBranding(displayName: string, avatarUrl: string | null = null): PublicBranding {
  return {
    displayName,
    bio: null,
    avatarUrl,
    coverUrl: null,
    accentColor: DEFAULT_ACCENT,
    template: 'classic',
    landingEnabled: true,
    defaultEventSlug: null,
    cardStyle: DEFAULT_CARD_STYLE,
    corners: DEFAULT_CORNERS,
    buttons: DEFAULT_BUTTONS,
    density: DEFAULT_DENSITY,
    font: DEFAULT_FONT,
    slotLayout: DEFAULT_SLOT_LAYOUT,
    dayGroup: DEFAULT_DAY_GROUP,
    slotSelect: DEFAULT_SLOT_SELECT,
  };
}

export function monogram(name: string): string {
  return (name.trim().charAt(0) || '?').toUpperCase();
}

// --- Theme presets (studio) — set all 9 axes at once; active theme DERIVED ---
export interface ThemeAxes {
  readonly template: BookingPageTemplate;
  readonly cardStyle: BookingCardStyle;
  readonly corners: BookingCorners;
  readonly buttons: BookingButtons;
  readonly density: BookingDensity;
  readonly font: BookingFont;
  readonly slotLayout: BookingSlotLayout;
  readonly dayGroup: BookingDayGroup;
  readonly slotSelect: BookingSlotSelect;
}

export type BookingTheme = 'minimal' | 'modern' | 'bold' | 'classic';
export const ALL_BOOKING_THEMES: readonly BookingTheme[] = ['minimal', 'modern', 'bold', 'classic'];

export const THEME_PRESETS: Record<BookingTheme, ThemeAxes> = {
  minimal: {
    template: 'split',
    cardStyle: 'outline',
    corners: 'sharp',
    buttons: 'square',
    density: 'compact',
    font: 'sans',
    slotLayout: 'list',
    dayGroup: 'flat',
    slotSelect: 'soft',
  },
  modern: {
    template: 'classic',
    cardStyle: 'outline',
    corners: 'soft',
    buttons: 'rounded',
    density: 'comfortable',
    font: 'sans',
    slotLayout: 'grid',
    dayGroup: 'flat',
    slotSelect: 'soft',
  },
  bold: {
    template: 'banded',
    cardStyle: 'filled',
    corners: 'round',
    buttons: 'pill',
    density: 'comfortable',
    font: 'rounded',
    slotLayout: 'grid',
    dayGroup: 'boxed',
    slotSelect: 'solid',
  },
  classic: {
    template: 'classic',
    cardStyle: 'elevated',
    corners: 'soft',
    buttons: 'rounded',
    density: 'comfortable',
    font: 'serif',
    slotLayout: 'list',
    dayGroup: 'boxed',
    slotSelect: 'soft',
  },
};

/** Which theme the current axes match exactly, or null when fine-tuned ("Custom"). */
export function matchTheme(axes: ThemeAxes): BookingTheme | null {
  return (
    ALL_BOOKING_THEMES.find((theme) => {
      const p = THEME_PRESETS[theme];
      return (
        p.template === axes.template &&
        p.cardStyle === axes.cardStyle &&
        p.corners === axes.corners &&
        p.buttons === axes.buttons &&
        p.density === axes.density &&
        p.font === axes.font &&
        p.slotLayout === axes.slotLayout &&
        p.dayGroup === axes.dayGroup &&
        p.slotSelect === axes.slotSelect
      );
    }) ?? null
  );
}
