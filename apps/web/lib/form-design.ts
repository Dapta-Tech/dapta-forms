import type { CSSProperties } from 'react';
import type { FormBranding, ResolvedFormDesign } from '@quill/engine';
import { designAttributes, resolveDesign } from '@quill/engine';
import { formThemeVars, resolveThemeMode } from '@quill/shared';
import { customFontFace, formFontStack } from './fonts';

/**
 * Everything the `.pf` root needs to render a form's design, computed once.
 *
 * This exists so the public page, the builder's live preview and the builder
 * canvas cannot drift apart. Before the design system there were three separate
 * opinions about what a form looked like — the renderer read the CSS, the
 * preview hand-copied one accent variable into Tailwind classes, and the canvas
 * ignored branding entirely. Any surface that spreads these props is correct by
 * construction, and a new axis reaches all three at once.
 */
export interface FormDesignProps {
  /** Inline custom properties: the color tokens plus the resolved font stack. */
  style: CSSProperties;
  /** `data-pf-*` attributes the CSS keys its overrides off. */
  attrs: Record<string, string>;
  /** An `@font-face` rule to inject, or null when the face is a curated one. */
  fontFace: string | null;
  /** The axes, already resolved — for the props CSS can't express (progress). */
  design: ResolvedFormDesign;
  /**
   * `light` / `dark` when the author fixed a background, null when the form
   * still inherits the viewer's preference. Rendered as `data-pf-theme` so the
   * lock is inspectable, and so a future rule can branch on it.
   */
  themeMode: 'light' | 'dark' | null;
}

export function formDesignProps(branding: FormBranding | null | undefined): FormDesignProps {
  const design = resolveDesign(branding);
  const themeMode = resolveThemeMode(branding?.background);

  // Assembled as a plain record — `CSSProperties` has no index signature, so
  // custom properties can't be assigned to it directly — and cast once at the end.
  const vars: Record<string, string> = {
    ...formThemeVars({
      background: branding?.background,
      foreground: branding?.foreground,
      primaryColor: branding?.primaryColor,
    }),
    '--pf-font': formFontStack(design.font, design.customFont?.name),
  };

  if (design.backgroundImage) {
    // Quotes + the schema's protocol check keep this inside the url() token; a
    // value that escaped it would be a CSS injection, not just a broken image.
    vars['--pf-bg-image'] = `url("${design.backgroundImage.replace(/["\\)]/g, '')}")`;
    vars['--pf-bg-overlay'] = `${design.backgroundOverlay}%`;
  }

  const style = vars as CSSProperties;

  const attrs = designAttributes(design);
  if (themeMode) attrs['data-pf-theme'] = themeMode;
  else {
    // The form fixed no colours, so it takes the PRODUCT default rather than the
    // current document's scheme.
    //
    // The root layout stamps `data-theme` from the viewer's cookie on every route,
    // and the note there reads that as "an unbranded form inherits the viewer's
    // preference". A respondent has no such cookie — `getThemePref` falls back to
    // `'dark'`, not to `'system'` — so in practice every respondent already saw
    // dark. The only person whose cookie ever applied was the AUTHOR, inside their
    // own builder: pick Light in the sidebar and the preview showed the form on
    // paper while every visitor got it dark. That is the preview lying about the
    // published page, which is the one thing it exists not to do.
    //
    // Pinning it here rather than at the route keeps the rule where the answer
    // already lives — `themeMode` is exactly "did the author decide this?" — and
    // covers the preview iframe, the real public page and the profile page in one
    // place. A branded form is untouched: it pins its own colours inline.
    attrs['data-theme'] = 'dark';
  }

  return {
    style,
    attrs,
    fontFace: design.customFont ? customFontFace(design.customFont.name, design.customFont.url) : null,
    design,
    themeMode,
  };
}
