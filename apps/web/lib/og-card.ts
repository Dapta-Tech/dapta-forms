import {
  type FormBranding,
  type FormProgressStyle,
  type FormFont,
  resolveDesign,
} from '@quill/engine';
import {
  blendHex,
  clampAccent,
  DEFAULT_ACCENT,
  DEFAULT_CANVAS,
  DEFAULT_CANVAS_FOREGROUND,
  isLightColor,
  onAccent,
  readableOn,
} from '@quill/shared';

/**
 * The share card's design, resolved from the form's own design.
 *
 * The card is the first thing most respondents see, so it has to be the same
 * object as the page behind it: same palette, same typeface, same corners, same
 * button. This module is the translation layer for the one reason the card
 * cannot simply reuse `formDesignProps` — that returns CSS custom properties and
 * `color-mix()`, and Satori (what `next/og` rasterizes with) resolves neither. So
 * every value the stylesheet DERIVES is derived here instead, with the same
 * helpers from `@quill/shared`, and comes out as a literal a rasterizer accepts.
 *
 * Kept pure and separate from the route so the mapping can be read and tested
 * without rendering a PNG.
 *
 * ── The one deliberate divergence ──────────────────────────────────────────
 * A form that set NO branding is not drawn on a blank white rectangle. It takes
 * the product's own console palette, which is the same call `formDesignProps`
 * already makes when it pins an unbranded form to `data-theme="dark"`: absent an
 * author's decision, the product's look is the honest answer, and it is the one
 * the respondent will see on the page a click later.
 */

/**
 * Corner radii, in px, for the roles the card actually draws — the banner chip,
 * the call to action, and the progress rail. `--pf-radius` and `--pf-radius-logo`
 * have no counterpart here on purpose: the card frames no panel and plates no
 * logo, and a resolved value nothing reads is a value that silently goes wrong.
 */
export interface OgRadii {
  chip: number;
  button: number;
  pill: number;
}

export interface OgCardStyle {
  /** Did the author choose a palette, or is this the product console? */
  branded: boolean;
  /** Flat fill under everything. */
  background: string;
  /** A CSS gradient painted over `background`, or null for a flat ground. */
  backgroundImage: string | null;
  foreground: string;
  /** The author's accent, exactly as chosen. */
  accent: string;
  /** The accent where it has to READ as a line rather than a fill. */
  accentEdge: string;
  /** Chip / panel fill — one step off the ground. */
  surface: string;
  hairline: string;
  /** Body copy that is not the headline. */
  quiet: string;
  /** Metadata: the quietest legible tier. */
  faint: string;
  /**
   * The author's background photograph, already vetted by `resolveDesign` — it
   * is non-null only when the background style really is `image` AND the URL is
   * usable, so the route never has to re-ask that question.
   */
  backdropUrl: string | null;
  /** 0–100. How heavily the readability scrim covers that photograph. */
  backdropOverlay: number;
  radii: OgRadii;
  button: { background: string; color: string; border: string | null };
  align: 'flex-start' | 'center';
  logo: { height: number; centered: boolean; drawAuthorLogo: boolean };
  progress: FormProgressStyle;
  font: FormFont;
  /** Which artwork the Dapta Forms mark should use. */
  isDark: boolean;
}

/**
 * The card is a ~1.5× zoom of the form — a 1200px image standing in for a 800px
 * column — so the corners scale with it. Left at their CSS values, a `round`
 * form's 24px card read tighter on the card than on the page it advertises.
 * `sharp` and the pill roles are exempt: 2px scaled is still 2px to the eye, and
 * a pill is a pill at any size.
 */
const RADIUS_ZOOM = 1.5;
const z = (n: number): number => Math.round(n * RADIUS_ZOOM);

const RADII: Record<'sharp' | 'soft' | 'round', OgRadii> = {
  sharp: { chip: 2, button: 2, pill: 2 },
  soft: { chip: z(6), button: z(8), pill: 999 },
  round: { chip: z(10), button: 999, pill: 999 },
};

/** Logo heights, the form's `--pf-logo` scale at card zoom. */
const LOGO_HEIGHTS: Record<'sm' | 'md' | 'lg', number> = { sm: z(22), md: z(30), lg: z(38) };

/** `rgba()` from a hex, for the places a gradient needs transparency. */
function withAlpha(hex: string, alpha: number): string {
  const c = hex.replace('#', '');
  const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  if (full.length !== 6) return hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * The product console, written out rather than derived.
 *
 * These are the literal values of `tokens.css`'s dark block. Deriving them from
 * `#0a0c0e` with the same blends a branded form uses would land near them but
 * not on them, and "near the product's palette" is the one result this card
 * must not produce.
 */
const CONSOLE = {
  background: DEFAULT_CANVAS,
  foreground: DEFAULT_CANVAS_FOREGROUND,
  surface: '#161c22',
  hairline: 'rgba(148, 170, 190, 0.16)',
  quiet: '#93a1ae',
  faint: '#758592',
} as const;

export function resolveCardStyle(branding: FormBranding | null | undefined): OgCardStyle {
  const design = resolveDesign(branding);
  const chosenBackground = branding?.background?.trim() || null;
  const branded = Boolean(chosenBackground);

  const background = chosenBackground ?? CONSOLE.background;
  const foreground = branded
    ? branding?.foreground?.trim() || readableOn(background)
    : CONSOLE.foreground;

  // `color-mix(in srgb, foreground N%, background)` — the same ladder
  // `formThemeVars` writes, evaluated here because Satori cannot evaluate it.
  const toward = (pct: number): string => blendHex(background, foreground, pct / 100);

  const accent = branding?.primaryColor?.trim() || DEFAULT_ACCENT;
  const accentEdge = clampAccent(accent, background);

  const radii = RADII[design.radius];

  const button = ((): OgCardStyle['button'] => {
    switch (design.buttonStyle) {
      case 'outline':
        return { background: 'transparent', color: foreground, border: `2px solid ${accentEdge}` };
      case 'soft':
        return {
          background: blendHex(background, accent, 0.18),
          color: foreground,
          border: `1px solid ${blendHex(background, accent, 0.32)}`,
        };
      default:
        return { background: accent, color: onAccent(accent), border: null };
    }
  })();

  // A branded form's ground is the author's; an unbranded one gets the product's
  // own glow, because that ground is ours to design.
  const backgroundImage = ((): string | null => {
    if (!branded) {
      return `radial-gradient(980px 460px at 88% -12%, ${withAlpha(accent, 0.15)}, transparent 62%)`;
    }
    switch (design.backgroundStyle) {
      case 'gradient':
        return `linear-gradient(165deg, ${blendHex(background, accent, 0.16)} 0%, ${background} 58%)`;
      case 'glow':
        return `radial-gradient(70% 50% at 50% 0%, ${withAlpha(accent, 0.22)} 0%, transparent 70%)`;
      // `image` needs a fetched file, which is the route's job — it paints the
      // photograph itself and leaves this null. `solid` is flat on purpose.
      default:
        return null;
    }
  })();

  return {
    branded,
    background,
    backgroundImage,
    backdropUrl: design.backgroundImage,
    backdropOverlay: design.backgroundOverlay,
    foreground,
    accent,
    accentEdge,
    surface: branded ? toward(5) : CONSOLE.surface,
    hairline: branded ? toward(16) : CONSOLE.hairline,
    quiet: branded ? toward(62) : CONSOLE.quiet,
    faint: branded ? toward(45) : CONSOLE.faint,
    radii,
    button,
    align: design.contentAlign === 'center' ? 'center' : 'flex-start',
    logo: {
      height: LOGO_HEIGHTS[design.logoSize],
      centered: design.logoPosition === 'center',
      // The author's logo is drawn only on a ground the AUTHOR chose.
      //
      // A logo is artwork with a fixed colour and no idea what is behind it. An
      // author who picked their own background picked it while looking at their
      // own mark on it, so that pairing is known to work. On the console ground
      // — which we choose for them — it is a coin flip, and there is nothing in
      // a URL that says which way the coin landed.
      //
      // Plating it white was the first answer and it is worse than not drawing
      // it: `dapta-mark.png` is white artwork (mean luminance of its opaque
      // pixels, measured: 236/255), so the plate meant to rescue a dark logo
      // erased a light one completely. `tokens.css` hits the mirror image of
      // this and solves it with `--brand-ink`, a fixed DARK tile — which only
      // works there because that one asset's colour is known. Here it is not.
      //
      // So the card omits it and the Dapta Forms mark takes the rail. A missing
      // logo reads as a design decision; a logo dissolved into its own backing
      // plate reads as a broken image.
      drawAuthorLogo: branded,
    },
    progress: design.progressStyle,
    font: design.font,
    isDark: !isLightColor(background),
  };
}

/** The scrim a background photograph is read through, at the author's opacity. */
export function backgroundScrim(style: OgCardStyle, overlayPercent: number): string {
  return withAlpha(style.background, Math.max(0, Math.min(100, overlayPercent)) / 100);
}
