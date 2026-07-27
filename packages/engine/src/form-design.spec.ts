import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FORM_FONT,
  FORM_THEME_PRESETS,
  LEGACY_FORM_DESIGN,
  designAttributes,
  findThemePreset,
  resolveCustomFont,
  resolveDesign,
} from './form-design';

describe('resolveDesign — legacy defaults', () => {
  // The whole additive-config promise rests on this: a form saved before the
  // design system existed must resolve to exactly the old look.
  it('resolves an absent branding to the legacy design', () => {
    expect(resolveDesign(undefined)).toEqual(LEGACY_FORM_DESIGN);
    expect(resolveDesign(null)).toEqual(LEGACY_FORM_DESIGN);
    expect(resolveDesign({})).toEqual(LEGACY_FORM_DESIGN);
  });

  it('keeps Poppins as the default face', () => {
    expect(resolveDesign({}).font).toBe('poppins');
    expect(DEFAULT_FORM_FONT).toBe('poppins');
  });

  it('leaves untouched axes at their legacy value when one axis is set', () => {
    const d = resolveDesign({ radius: 'round' });
    expect(d.radius).toBe('round');
    expect(d.buttonStyle).toBe(LEGACY_FORM_DESIGN.buttonStyle);
    expect(d.progressStyle).toBe(LEGACY_FORM_DESIGN.progressStyle);
    expect(d.transition).toBe(LEGACY_FORM_DESIGN.transition);
  });
});

describe('resolveDesign — explicit axes', () => {
  it('passes every axis through', () => {
    const d = resolveDesign({
      radius: 'sharp',
      buttonStyle: 'outline',
      buttonFullWidth: false,
      progressStyle: 'dots',
      logoSize: 'lg',
      logoPosition: 'left',
      contentAlign: 'left',
      contentWidth: 'wide',
      transition: 'fade',
    });
    expect(d).toMatchObject({
      radius: 'sharp',
      buttonStyle: 'outline',
      buttonFullWidth: false,
      progressStyle: 'dots',
      logoSize: 'lg',
      logoPosition: 'left',
      contentAlign: 'left',
      contentWidth: 'wide',
      transition: 'fade',
    });
  });

  it('defaults the alignment to centre, matching the pre-design renderer', () => {
    // `.pf__question` has always been `text-align: center`. If this ever flips,
    // every published form silently re-aligns.
    expect(resolveDesign({}).contentAlign).toBe('center');
    expect(designAttributes(resolveDesign({}))['data-pf-align']).toBe('center');
  });

  it('honours an explicit false for buttonFullWidth', () => {
    // `?? ` not `||` — `false` is a real choice, not an absent value.
    expect(resolveDesign({ buttonFullWidth: false }).buttonFullWidth).toBe(false);
    expect(resolveDesign({}).buttonFullWidth).toBe(true);
  });

  it('progressStyle "none" survives resolution', () => {
    expect(resolveDesign({ progressStyle: 'none' }).progressStyle).toBe('none');
  });
});

describe('resolveDesign — background image cross-validation', () => {
  it('keeps the image when style and url are both present', () => {
    const d = resolveDesign({ backgroundStyle: 'image', backgroundImage: 'https://x.test/a.jpg' });
    expect(d.backgroundStyle).toBe('image');
    expect(d.backgroundImage).toBe('https://x.test/a.jpg');
  });

  it('falls back to solid when image style has no url', () => {
    // An empty image layer would paint the page a flat nothing.
    expect(resolveDesign({ backgroundStyle: 'image' }).backgroundStyle).toBe('solid');
    expect(resolveDesign({ backgroundStyle: 'image', backgroundImage: '   ' }).backgroundStyle).toBe('solid');
  });

  it('ignores a stored image when the style is not image', () => {
    const d = resolveDesign({ backgroundStyle: 'gradient', backgroundImage: 'https://x.test/a.jpg' });
    expect(d.backgroundStyle).toBe('gradient');
    expect(d.backgroundImage).toBeNull();
  });

  it('clamps the overlay to 0–100 and rounds it', () => {
    expect(resolveDesign({ backgroundOverlay: -20 }).backgroundOverlay).toBe(0);
    expect(resolveDesign({ backgroundOverlay: 180 }).backgroundOverlay).toBe(100);
    expect(resolveDesign({ backgroundOverlay: 42.6 }).backgroundOverlay).toBe(43);
    expect(resolveDesign({ backgroundOverlay: Number.NaN }).backgroundOverlay).toBe(
      LEGACY_FORM_DESIGN.backgroundOverlay,
    );
  });
});

describe('resolveCustomFont / custom face fallback', () => {
  it('needs both a name and a url', () => {
    expect(resolveCustomFont({ name: 'Untitled Sans', url: 'https://x.test/f.woff2' })).toEqual({
      name: 'Untitled Sans',
      url: 'https://x.test/f.woff2',
    });
    expect(resolveCustomFont({ name: 'Untitled Sans', url: '' })).toBeNull();
    expect(resolveCustomFont({ name: '', url: 'https://x.test/f.woff2' })).toBeNull();
    expect(resolveCustomFont(null)).toBeNull();
  });

  it('trims both halves', () => {
    expect(resolveCustomFont({ name: '  Soehne  ', url: '  https://x.test/f.woff2 ' })).toEqual({
      name: 'Soehne',
      url: 'https://x.test/f.woff2',
    });
  });

  it('falls back to the default face when custom is chosen but incomplete', () => {
    // An @font-face with no src silently never resolves — better to render the
    // brand face than nothing.
    const d = resolveDesign({ fontFamily: 'custom', customFont: { name: 'X', url: '' } });
    expect(d.font).toBe(DEFAULT_FORM_FONT);
    expect(d.customFont).toBeNull();
  });

  it('keeps the custom face when it is complete', () => {
    const d = resolveDesign({
      fontFamily: 'custom',
      customFont: { name: 'Soehne', url: 'https://x.test/f.woff2' },
    });
    expect(d.font).toBe('custom');
    expect(d.customFont).toEqual({ name: 'Soehne', url: 'https://x.test/f.woff2' });
  });

  it('ignores a stored custom font when a curated face is selected', () => {
    const d = resolveDesign({
      fontFamily: 'inter',
      customFont: { name: 'Soehne', url: 'https://x.test/f.woff2' },
    });
    expect(d.font).toBe('inter');
    expect(d.customFont).toBeNull();
  });
});

describe('designAttributes', () => {
  it('emits one data attribute per axis', () => {
    const attrs = designAttributes(resolveDesign({}));
    expect(attrs).toEqual({
      'data-pf-radius': 'soft',
      'data-pf-button': 'solid',
      'data-pf-button-width': 'full',
      'data-pf-progress': 'bar',
      'data-pf-bg': 'solid',
      'data-pf-logo-size': 'md',
      'data-pf-logo-pos': 'center',
      'data-pf-align': 'center',
      'data-pf-width': 'narrow',
      'data-pf-transition': 'slide',
    });
  });

  it('maps buttonFullWidth to a string enum, not a boolean attribute', () => {
    // `data-x={false}` renders as the string "false" in React, which CSS would
    // then match on — an explicit enum removes the ambiguity.
    expect(designAttributes(resolveDesign({ buttonFullWidth: false }))['data-pf-button-width']).toBe('auto');
  });
});

describe('theme presets', () => {
  it('every preset has a unique id', () => {
    const ids = FORM_THEME_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every preset uses six-digit hex colors', () => {
    for (const p of FORM_THEME_PRESETS) {
      expect(p.background, p.id).toMatch(/^#[0-9a-f]{6}$/);
      expect(p.foreground, p.id).toMatch(/^#[0-9a-f]{6}$/);
      expect(p.primaryColor, p.id).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('ships both dark and light starting points', () => {
    // A picker that only offers dark grounds is not a picker.
    const darks = FORM_THEME_PRESETS.filter((p) => p.background < '#800000');
    expect(darks.length).toBeGreaterThan(0);
    expect(darks.length).toBeLessThan(FORM_THEME_PRESETS.length);
  });

  it('midnight reproduces the pre-design look', () => {
    const midnight = findThemePreset('midnight');
    expect(midnight).not.toBeNull();
    expect(midnight?.background).toBe('#222222');
    expect(midnight?.primaryColor).toBe('#cbe84f');
    expect(midnight?.font).toBe(DEFAULT_FORM_FONT);
  });

  it('findThemePreset returns null for unknown or absent ids', () => {
    expect(findThemePreset('nope')).toBeNull();
    expect(findThemePreset(null)).toBeNull();
    expect(findThemePreset(undefined)).toBeNull();
  });
});
