/**
 * Unit tests for the share card's design resolution — the layer that turns a
 * form's branding into literals a rasterizer accepts. The card cannot be diffed
 * as a PNG, so what is asserted here is the mapping: that an authored axis
 * reaches the card, and that an unauthored one lands on the product's own look
 * rather than on a browser default.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_ACCENT, DEFAULT_CANVAS, DEFAULT_CANVAS_FOREGROUND } from '@quill/shared';
import { backgroundScrim, resolveCardStyle } from './og-card';

describe('resolveCardStyle — the unbranded card', () => {
  it('takes the product console rather than a blank page', () => {
    const style = resolveCardStyle(null);
    expect(style.branded).toBe(false);
    expect(style.background).toBe(DEFAULT_CANVAS);
    expect(style.foreground).toBe(DEFAULT_CANVAS_FOREGROUND);
    expect(style.accent).toBe(DEFAULT_ACCENT);
    expect(style.isDark).toBe(true);
  });

  it('lights its own ground, because that ground is ours to design', () => {
    expect(resolveCardStyle(null).backgroundImage).toContain('radial-gradient');
  });

  it('plates the logo, since a dark ground WE chose can swallow a dark mark', () => {
    expect(resolveCardStyle(null).logo.plate).toBe('#ffffff');
  });
});

describe('resolveCardStyle — the authored card', () => {
  it('paints the author colours exactly as chosen', () => {
    const style = resolveCardStyle({ background: '#ffffff', foreground: '#0d0d0f', primaryColor: '#cbe84f' });
    expect(style.branded).toBe(true);
    expect(style.background).toBe('#ffffff');
    expect(style.foreground).toBe('#0d0d0f');
    expect(style.accent).toBe('#cbe84f');
    expect(style.isDark).toBe(false);
  });

  it('derives the surface ladder from that pair, not from the product tokens', () => {
    const style = resolveCardStyle({ background: '#ffffff', foreground: '#0d0d0f' });
    // Every derived tier has to sit between the two chosen ends.
    for (const tier of [style.surface, style.hairline, style.quiet, style.faint]) {
      expect(tier).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tier).not.toBe('#ffffff');
    }
    expect(style.quiet).not.toBe(style.faint);
  });

  it('leaves an author-chosen dark background to carry its own logo', () => {
    // They picked that ground while looking at their own mark on it; plating it
    // would repaint a form that is already correct.
    expect(resolveCardStyle({ background: '#101010' }).logo.plate).toBeNull();
  });

  it('honours a solid background by painting no gradient at all', () => {
    expect(resolveCardStyle({ background: '#ffffff', backgroundStyle: 'solid' }).backgroundImage).toBeNull();
  });

  it('mirrors the gradient and glow treatments', () => {
    expect(
      resolveCardStyle({ background: '#ffffff', backgroundStyle: 'gradient' }).backgroundImage,
    ).toContain('linear-gradient');
    expect(
      resolveCardStyle({ background: '#ffffff', backgroundStyle: 'glow' }).backgroundImage,
    ).toContain('radial-gradient');
  });

  it('leaves the photograph to the route, which is the only place that can fetch it', () => {
    const style = resolveCardStyle({
      background: '#ffffff',
      backgroundStyle: 'image',
      backgroundImage: 'https://cdn.example.com/hero.png',
      backgroundOverlay: 70,
    });
    expect(style.backgroundImage).toBeNull();
    expect(style.backdropUrl).toBe('https://cdn.example.com/hero.png');
    expect(style.backdropOverlay).toBe(70);
  });
});

describe('resolveCardStyle — the shape axes', () => {
  it('squares every role for a sharp form, the pill included', () => {
    const { radii } = resolveCardStyle({ radius: 'sharp' });
    expect(Object.values(radii)).toEqual([2, 2, 2, 2, 2]);
  });

  it('gives a round form a pill button', () => {
    expect(resolveCardStyle({ radius: 'round' }).radii.button).toBe(999);
  });

  it('scales soft corners with the card without inventing a new scale', () => {
    const { radii } = resolveCardStyle({ radius: 'soft' });
    expect(radii.card).toBe(24); // 16px at the card's 1.5× zoom
    expect(radii.pill).toBe(999);
  });
});

describe('resolveCardStyle — the button', () => {
  it('fills a solid button with the accent and picks the label for contrast', () => {
    const style = resolveCardStyle({ primaryColor: '#cbe84f', buttonStyle: 'solid' });
    expect(style.button.background).toBe('#cbe84f');
    expect(style.button.border).toBeNull();
    expect(style.button.color).not.toBe('#cbe84f');
  });

  it('keeps an outline button transparent and its label on the foreground', () => {
    const style = resolveCardStyle({ background: '#ffffff', foreground: '#0d0d0f', buttonStyle: 'outline' });
    expect(style.button.background).toBe('transparent');
    expect(style.button.color).toBe('#0d0d0f');
    expect(style.button.border).toContain('solid');
  });

  it('washes a soft button rather than filling it', () => {
    const style = resolveCardStyle({ background: '#ffffff', primaryColor: '#cbe84f', buttonStyle: 'soft' });
    expect(style.button.background).not.toBe('#cbe84f');
    expect(style.button.background).not.toBe('#ffffff');
    expect(style.button.border).toContain('1px solid');
  });
});

describe('resolveCardStyle — the rest of the design', () => {
  it('carries the progress style through, including off', () => {
    expect(resolveCardStyle({ progressStyle: 'dots' }).progress).toBe('dots');
    expect(resolveCardStyle({ progressStyle: 'none' }).progress).toBe('none');
  });

  it('carries the typeface through, so the card is set in the form’s own face', () => {
    expect(resolveCardStyle({ fontFamily: 'poppins' }).font).toBe('poppins');
  });

  it('follows the content alignment', () => {
    expect(resolveCardStyle({ contentAlign: 'left' }).align).toBe('flex-start');
    expect(resolveCardStyle({ contentAlign: 'center' }).align).toBe('center');
  });

  it('scales the logo with the form’s own logo size', () => {
    const sm = resolveCardStyle({ logoSize: 'sm' }).logo.height;
    const lg = resolveCardStyle({ logoSize: 'lg' }).logo.height;
    expect(lg).toBeGreaterThan(sm);
    expect(resolveCardStyle({ logoPosition: 'center' }).logo.centered).toBe(true);
  });
});

describe('backgroundScrim', () => {
  it('expresses the author’s overlay percentage as alpha over their ground', () => {
    const style = resolveCardStyle({ background: '#ffffff' });
    expect(backgroundScrim(style, 70)).toBe('rgba(255, 255, 255, 0.7)');
  });

  it('clamps a value the schema would not have produced', () => {
    const style = resolveCardStyle({ background: '#000000' });
    expect(backgroundScrim(style, 300)).toBe('rgba(0, 0, 0, 1)');
    expect(backgroundScrim(style, -20)).toBe('rgba(0, 0, 0, 0)');
  });
});
