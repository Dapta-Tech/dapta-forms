/**
 * Form design system — the presentation axes an author controls, and the single
 * place that answers "what does this form actually look like?".
 *
 * Every axis is OPTIONAL in the config and every absent value resolves here to
 * the look the renderer had before the axis existed. That is what lets a form
 * published years ago keep rendering byte-identically while new forms get the
 * full control surface (config invariant #4: extend v1, never break it).
 *
 * This module is deliberately COLOR-MATH-FREE. Contrast clamping, theme
 * derivation and CSS-variable generation need luminance math and live in
 * `@quill/shared/branding`; the unions and the non-color resolution live here so
 * `@quill/types` can build its zod enums without taking a new package
 * dependency. The split is: engine says *which* axis values exist, shared says
 * *what color* comes out.
 */

// ---------------------------------------------------------------------------
// The axes. Each is a closed union so the zod schema, the editor control and
// the CSS class map are all generated from one list and cannot drift.
// ---------------------------------------------------------------------------

/** Corner rounding, applied to cards, inputs and buttons together. */
export const FORM_RADII = ['sharp', 'soft', 'round'] as const;
export type FormRadius = (typeof FORM_RADII)[number];

/** How the primary action is filled. */
export const FORM_BUTTON_STYLES = ['solid', 'outline', 'soft'] as const;
export type FormButtonStyle = (typeof FORM_BUTTON_STYLES)[number];

/** How progress through the steps is signalled. */
export const FORM_PROGRESS_STYLES = ['bar', 'dots', 'steps', 'none'] as const;
export type FormProgressStyle = (typeof FORM_PROGRESS_STYLES)[number];

/** What fills the page behind the form. */
export const FORM_BACKGROUND_STYLES = ['solid', 'gradient', 'glow', 'image'] as const;
export type FormBackgroundStyle = (typeof FORM_BACKGROUND_STYLES)[number];

/** Text alignment of the question group. */
export const FORM_CONTENT_ALIGNS = ['left', 'center'] as const;
export type FormContentAlign = (typeof FORM_CONTENT_ALIGNS)[number];

/** The measure the question column is held to. */
export const FORM_CONTENT_WIDTHS = ['narrow', 'wide'] as const;
export type FormContentWidth = (typeof FORM_CONTENT_WIDTHS)[number];

/** The between-steps animation. Always subject to `prefers-reduced-motion`. */
export const FORM_TRANSITIONS = ['slide', 'fade', 'none'] as const;
export type FormTransition = (typeof FORM_TRANSITIONS)[number];

/** Logo scale in the top bar. */
export const FORM_LOGO_SIZES = ['sm', 'md', 'lg'] as const;
export type FormLogoSize = (typeof FORM_LOGO_SIZES)[number];

/** Logo placement in the top bar. */
export const FORM_LOGO_POSITIONS = ['left', 'center'] as const;
export type FormLogoPosition = (typeof FORM_LOGO_POSITIONS)[number];

/**
 * The curated typeface list.
 *
 * A curated set rather than "any Google font" is a deliberate product call:
 * `next/font` resolves at BUILD time, so a runtime-arbitrary family could only
 * be loaded with a live request to a font CDN from the public form — which adds
 * a third-party dependency to a page that is meant to run in a bare fork with
 * nothing configured. These eight are declared, self-hosted and offline-safe.
 *
 * `custom` is the escape hatch: the author supplies their own `@font-face`
 * source (see `customFont`). It is a value of this union rather than a separate
 * flag so the renderer has exactly one question to ask.
 */
export const FORM_FONTS = [
  'visby',
  'poppins',
  'inter',
  'dm-sans',
  'space-grotesk',
  'manrope',
  'work-sans',
  'fraunces',
  'playfair',
  'custom',
] as const;
export type FormFont = (typeof FORM_FONTS)[number];

/**
 * Visby CF is the Dapta brand typeface and the default face.
 *
 * It replaced Poppins (the previous default, A6) when the product adopted the
 * marketing site's type system. Poppins stays in the list above rather than being
 * removed: it is a value a published form may already carry, and dropping it from
 * the union would fail that form's config at parse time (invariant #4 — extend
 * v1, never break it).
 */
export const DEFAULT_FORM_FONT: FormFont = 'visby';

/** Which of the curated faces are serifs — the editor groups the picker by this. */
export const FORM_SERIF_FONTS: readonly FormFont[] = ['fraunces', 'playfair'];

// ---------------------------------------------------------------------------
// The shape this module reads. Structural rather than importing `FormBranding`
// from `form-logic`, so the two modules stay acyclic — same reason
// `resolveOptionLayout` takes a `Pick<>` instead of a whole `FormStep`.
// ---------------------------------------------------------------------------

/** An author-supplied typeface: a family name plus a font file to load it from. */
export interface FormCustomFont {
  /** The `font-family` name to declare. */
  name: string;
  /** Where the file lives. This repo has no asset storage, so it is a URL. */
  url: string;
}

/** The design-bearing subset of `branding` that this module resolves. */
export interface FormDesignInput {
  background?: string | null;
  foreground?: string | null;
  backgroundStyle?: FormBackgroundStyle;
  backgroundImage?: string | null;
  backgroundOverlay?: number;
  fontFamily?: FormFont;
  customFont?: FormCustomFont | null;
  radius?: FormRadius;
  buttonStyle?: FormButtonStyle;
  buttonFullWidth?: boolean;
  progressStyle?: FormProgressStyle;
  logoSize?: FormLogoSize;
  logoPosition?: FormLogoPosition;
  contentAlign?: FormContentAlign;
  contentWidth?: FormContentWidth;
  transition?: FormTransition;
}

/**
 * Every axis decided. No optionals and no nulls except where "none" is a real
 * value — a consumer reads this and renders, it never re-applies a default.
 */
export interface ResolvedFormDesign {
  radius: FormRadius;
  buttonStyle: FormButtonStyle;
  buttonFullWidth: boolean;
  progressStyle: FormProgressStyle;
  backgroundStyle: FormBackgroundStyle;
  /** Non-null only when `backgroundStyle` is `image` AND a usable URL is set. */
  backgroundImage: string | null;
  /** 0–100. How much the readability scrim covers a background image. */
  backgroundOverlay: number;
  font: FormFont;
  /** Non-null only when `font` is `custom` AND the source is complete + safe. */
  customFont: FormCustomFont | null;
  logoSize: FormLogoSize;
  logoPosition: FormLogoPosition;
  contentAlign: FormContentAlign;
  contentWidth: FormContentWidth;
  transition: FormTransition;
}

/**
 * What a form renders as when it never set an axis, kept as an explicit table
 * rather than inline `??`s so "what does an unstyled form look like" is one thing
 * to read and one thing to test.
 *
 * Changing a value here restyles every form that never set that axis — including
 * already-published ones. That is normally the reason not to touch it, and it is
 * why exactly ONE axis moved in the Master Control Room migration:
 *
 *  - `font` follows `DEFAULT_FORM_FONT`, so it became Visby CF with the brand.
 *
 * `radius` briefly became `sharp` to match the marketing site's strictly square
 * world, and went back to `soft`: on a dense form surface hard corners read as
 * harsh rather than deliberate. `sharp` is still a real choice — and now a
 * complete one, since the `data-pf-radius` block in `public-form.css` squares the
 * chip and pill roles too instead of leaving lozenge progress bars behind.
 *
 * Every LAYOUT axis below is untouched on purpose. Colors and type were the
 * migration's scope; re-aligning or re-flowing live forms was not, and an axis
 * like `contentAlign` would silently re-compose every form ever published.
 */
export const LEGACY_FORM_DESIGN: ResolvedFormDesign = {
  radius: 'soft',
  buttonStyle: 'solid',
  buttonFullWidth: true,
  progressStyle: 'bar',
  backgroundStyle: 'solid',
  backgroundImage: null,
  backgroundOverlay: 55,
  font: DEFAULT_FORM_FONT,
  customFont: null,
  logoSize: 'md',
  logoPosition: 'center',
  // The renderer has always centred the question and helper (`public-form.css`
  // → `.pf__question`). Defaulting this to `left` would silently re-align every
  // form ever published, which is exactly the kind of change the legacy table
  // exists to prevent.
  contentAlign: 'center',
  contentWidth: 'narrow',
  transition: 'slide',
};

/** Default scrim over a background image, in percent. */
export const DEFAULT_BACKGROUND_OVERLAY = LEGACY_FORM_DESIGN.backgroundOverlay;

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function clampPercent(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * A custom font only counts when BOTH halves are present: a family name to
 * declare and a source to load. A half-filled pair would emit an `@font-face`
 * that silently never resolves, so it degrades to the default face instead —
 * the same "render something legible rather than nothing" rule as
 * `resolveOptionIcon`'s image fallback.
 */
export function resolveCustomFont(font: FormCustomFont | null | undefined): FormCustomFont | null {
  const name = font?.name?.trim();
  const url = font?.url?.trim();
  if (!name || !url) return null;
  return { name, url };
}

/**
 * The single answer to "how does this form look?", shared by the public
 * renderer, the builder canvas and the live preview so the three cannot drift —
 * the same role `resolveOptionIcon` plays for a choice option.
 *
 * Two axes are cross-validated rather than taken at face value, so an editor
 * that lets a combination be saved can still never render it:
 *  - `image` with no usable image falls back to `solid` (an empty background
 *    layer would paint the page a flat transparent nothing);
 *  - `custom` with an incomplete font source falls back to the default face.
 */
export function resolveDesign(design: FormDesignInput | null | undefined): ResolvedFormDesign {
  const d = design ?? {};

  const customFont = d.fontFamily === 'custom' ? resolveCustomFont(d.customFont) : null;
  const font: FormFont =
    d.fontFamily === 'custom' && !customFont ? DEFAULT_FORM_FONT : (d.fontFamily ?? LEGACY_FORM_DESIGN.font);

  const wantsImage = d.backgroundStyle === 'image';
  const image = d.backgroundImage?.trim() || null;
  const backgroundImage = wantsImage && image ? image : null;
  const backgroundStyle: FormBackgroundStyle =
    wantsImage && !backgroundImage ? 'solid' : (d.backgroundStyle ?? LEGACY_FORM_DESIGN.backgroundStyle);

  return {
    radius: d.radius ?? LEGACY_FORM_DESIGN.radius,
    buttonStyle: d.buttonStyle ?? LEGACY_FORM_DESIGN.buttonStyle,
    buttonFullWidth: d.buttonFullWidth ?? LEGACY_FORM_DESIGN.buttonFullWidth,
    progressStyle: d.progressStyle ?? LEGACY_FORM_DESIGN.progressStyle,
    backgroundStyle,
    backgroundImage,
    backgroundOverlay: clampPercent(d.backgroundOverlay, LEGACY_FORM_DESIGN.backgroundOverlay),
    font,
    customFont,
    logoSize: d.logoSize ?? LEGACY_FORM_DESIGN.logoSize,
    logoPosition: d.logoPosition ?? LEGACY_FORM_DESIGN.logoPosition,
    contentAlign: d.contentAlign ?? LEGACY_FORM_DESIGN.contentAlign,
    contentWidth: d.contentWidth ?? LEGACY_FORM_DESIGN.contentWidth,
    transition: d.transition ?? LEGACY_FORM_DESIGN.transition,
  };
}

/**
 * The `data-pf-*` attributes the renderer stamps on the `.pf` root. Emitting
 * them from one function (rather than spelling them out in each of the three
 * surfaces) is what keeps the public page, the preview and the canvas honest:
 * add an axis here and every surface picks it up.
 */
export function designAttributes(design: ResolvedFormDesign): Record<string, string> {
  return {
    'data-pf-radius': design.radius,
    'data-pf-button': design.buttonStyle,
    'data-pf-button-width': design.buttonFullWidth ? 'full' : 'auto',
    'data-pf-progress': design.progressStyle,
    'data-pf-bg': design.backgroundStyle,
    'data-pf-logo-size': design.logoSize,
    'data-pf-logo-pos': design.logoPosition,
    'data-pf-align': design.contentAlign,
    'data-pf-width': design.contentWidth,
    'data-pf-transition': design.transition,
  };
}

// ---------------------------------------------------------------------------
// Theme presets (B1)
// ---------------------------------------------------------------------------

/**
 * A preset is a STARTING POINT, not a mode: applying one writes its values into
 * the individual fields and is then fully editable. Nothing at render time ever
 * reads `themePreset` — it is stored only so the editor can show which card is
 * currently selected, and it goes stale the moment an axis is hand-edited.
 *
 * This exists because picking five colors that work together is the part
 * authors are worst at; the individual controls become the advanced path.
 */
export interface FormThemePreset {
  id: string;
  /** Display name. Not localized — these read as proper nouns, like font names. */
  label: string;
  background: string;
  foreground: string;
  primaryColor: string;
  font: FormFont;
  radius: FormRadius;
  buttonStyle: FormButtonStyle;
}

export const FORM_THEME_PRESETS: readonly FormThemePreset[] = [
  /**
   * The house look — the same Master Control Room palette and type the app chrome
   * and the marketing site wear, offered as a preset so an author can get back to
   * it after wandering. It leads the list because it is what a new form already
   * looks like before anyone opens the design tab.
   */
  {
    id: 'control-room',
    label: 'Control Room',
    background: '#0a0c0e',
    foreground: '#e8edf2',
    primaryColor: '#d3e750',
    font: 'visby',
    radius: 'soft',
    buttonStyle: 'solid',
  },
  /**
   * The previous house look. Kept — with its id intact, so a form that stored
   * `themePreset: 'midnight'` still shows its card as selected — because it is a
   * perfectly good dark theme and someone chose it on purpose.
   */
  {
    id: 'midnight',
    label: 'Midnight',
    background: '#222222',
    foreground: '#eeeeee',
    primaryColor: '#cbe84f',
    font: 'poppins',
    radius: 'soft',
    buttonStyle: 'solid',
  },
  {
    id: 'paper',
    label: 'Paper',
    background: '#faf9f6',
    foreground: '#1c1c1a',
    primaryColor: '#2b6e4f',
    font: 'inter',
    radius: 'soft',
    buttonStyle: 'solid',
  },
  {
    id: 'noir',
    label: 'Noir',
    background: '#0d0d0f',
    foreground: '#f5f5f4',
    primaryColor: '#e0b64f',
    font: 'playfair',
    radius: 'sharp',
    buttonStyle: 'outline',
  },
  {
    id: 'ocean',
    label: 'Ocean',
    background: '#f4f8fb',
    foreground: '#12212e',
    primaryColor: '#1f6feb',
    font: 'dm-sans',
    radius: 'round',
    buttonStyle: 'solid',
  },
  {
    id: 'ember',
    label: 'Ember',
    background: '#1a1412',
    foreground: '#f7ece5',
    primaryColor: '#f2704a',
    font: 'space-grotesk',
    radius: 'soft',
    buttonStyle: 'solid',
  },
  {
    id: 'forest',
    label: 'Forest',
    background: '#101a14',
    foreground: '#e8f0e9',
    primaryColor: '#6dd39a',
    font: 'work-sans',
    radius: 'soft',
    buttonStyle: 'soft',
  },
  {
    id: 'linen',
    label: 'Linen',
    background: '#f7f2e9',
    foreground: '#2a241d',
    primaryColor: '#b5533a',
    font: 'fraunces',
    radius: 'round',
    buttonStyle: 'solid',
  },
  {
    id: 'violet',
    label: 'Violet',
    background: '#16121f',
    foreground: '#ece8f5',
    primaryColor: '#a78bfa',
    font: 'manrope',
    radius: 'soft',
    buttonStyle: 'soft',
  },
];

export function findThemePreset(id: string | null | undefined): FormThemePreset | null {
  if (!id) return null;
  return FORM_THEME_PRESETS.find((p) => p.id === id) ?? null;
}
