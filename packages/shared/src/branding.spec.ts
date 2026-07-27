import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACCENT,
  DEFAULT_CANVAS,
  accentWasAdjusted,
  clampAccent,
  contrastGrade,
  contrastRatio,
  formThemeVars,
  isLightColor,
  onAccent,
  readableOn,
  resolveThemeMode,
} from './branding';

describe('clampAccent — ground awareness', () => {
  it('defaults to the legacy dark canvas', () => {
    // Every pre-existing call site passes one argument; those must not shift.
    expect(clampAccent('#cbe84f')).toBe(clampAccent('#cbe84f', DEFAULT_CANVAS));
  });

  it('leaves an accent that already separates from its ground alone', () => {
    expect(clampAccent('#cbe84f', '#222222')).toBe('#cbe84f');
    expect(clampAccent('#1f6feb', '#ffffff')).toBe('#1f6feb');
  });

  it('LIGHTENS a too-dark accent on a dark ground', () => {
    const out = clampAccent('#1a1a1a', '#222222');
    expect(out).not.toBe('#1a1a1a');
    expect(contrastRatio(out, '#222222')).toBeGreaterThanOrEqual(3);
  });

  it('DARKENS a too-light accent on a light ground', () => {
    // The bug this whole change exists to fix: the old implementation always
    // mixed toward white, so on a white page a pastel got "clamped" lighter —
    // i.e. further into unreadable — and then reported as safe.
    const pastel = '#f2f7c8';
    const out = clampAccent(pastel, '#ffffff');
    expect(out).not.toBe(pastel);
    expect(contrastRatio(out, '#ffffff')).toBeGreaterThanOrEqual(3);
    // Darker than it started, not lighter.
    expect(out < pastel).toBe(true);
  });

  it('reaches a usable ratio on both grounds for the brand lime', () => {
    expect(contrastRatio(clampAccent(DEFAULT_ACCENT, '#222222'), '#222222')).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(clampAccent(DEFAULT_ACCENT, '#ffffff'), '#ffffff')).toBeGreaterThanOrEqual(3);
  });

  it('falls back to the brand accent for an unparseable color', () => {
    expect(clampAccent('not-a-color')).toBe(DEFAULT_ACCENT);
  });
});

describe('accentWasAdjusted', () => {
  it('is ground-relative', () => {
    // The same lime is fine on dark and needs nudging on white — the warning in
    // the editor has to follow the background the author actually chose.
    expect(accentWasAdjusted(DEFAULT_ACCENT, '#222222')).toBe(false);
    expect(accentWasAdjusted(DEFAULT_ACCENT, '#ffffff')).toBe(true);
  });

  it('is false for an unparseable color', () => {
    expect(accentWasAdjusted('rgb(1,2,3)')).toBe(false);
  });
});

describe('isLightColor / readableOn / resolveThemeMode', () => {
  it('classifies grounds', () => {
    expect(isLightColor('#ffffff')).toBe(true);
    expect(isLightColor('#faf9f6')).toBe(true);
    expect(isLightColor('#222222')).toBe(false);
    expect(isLightColor('#16121f')).toBe(false);
  });

  it('suggests a readable text color for a ground', () => {
    expect(readableOn('#ffffff')).toBe('#1a1a1c');
    expect(readableOn('#111111')).toBe('#fafafa');
    expect(contrastRatio(readableOn('#f7f2e9'), '#f7f2e9')).toBeGreaterThan(7);
  });

  it('returns null when no background is chosen — the form keeps inheriting', () => {
    expect(resolveThemeMode(null)).toBeNull();
    expect(resolveThemeMode(undefined)).toBeNull();
    expect(resolveThemeMode('')).toBeNull();
  });

  it('locks the theme once a background is chosen', () => {
    expect(resolveThemeMode('#faf9f6')).toBe('light');
    expect(resolveThemeMode('#101a14')).toBe('dark');
  });
});

describe('contrastRatio / contrastGrade', () => {
  it('is symmetric and bounded', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#ffffff', '#000000')).toBe(21);
    expect(contrastRatio('#808080', '#808080')).toBe(1);
  });

  it('returns 0 for an unparseable input rather than throwing', () => {
    expect(contrastRatio('nope', '#ffffff')).toBe(0);
  });

  it('grades against the WCAG body-text thresholds', () => {
    expect(contrastGrade(21)).toBe('AAA');
    expect(contrastGrade(7)).toBe('AAA');
    expect(contrastGrade(6.9)).toBe('AA');
    expect(contrastGrade(4.5)).toBe('AA');
    expect(contrastGrade(4.4)).toBe('fail');
  });
});

describe('formThemeVars', () => {
  it('emits nothing when the author set no colors — the form inherits', () => {
    expect(formThemeVars({})).toEqual({});
    expect(formThemeVars({ background: null, foreground: null })).toEqual({});
  });

  it('emits only accent vars when only an accent is set', () => {
    const vars = formThemeVars({ primaryColor: '#cbe84f' });
    expect(vars['--pf-primary']).toBe('#cbe84f');
    expect(vars['--pf-primary-contrast']).toBe(onAccent('#cbe84f'));
    // No ground was chosen, so the shared tokens must stay untouched.
    expect(vars['--background']).toBeUndefined();
    expect(vars['--card']).toBeUndefined();
  });

  it('paints the brand color EXACTLY as chosen wherever it is a fill', () => {
    // The product must not turn a client's lime into olive because the page
    // went white. Fills, and the label picked to sit on them, use the raw value.
    const lime = '#cbe84f';
    const onWhite = formThemeVars({ background: '#ffffff', primaryColor: lime });
    expect(onWhite['--pf-primary']).toBe(lime);
    expect(onWhite['--pf-primary-contrast']).toBe(onAccent(lime));
    // Black on lime is highly readable, which is why the fill needs no clamp.
    expect(contrastRatio(onAccent(lime), lime)).toBeGreaterThanOrEqual(4.5);
  });

  it('clamps ONLY the accent-as-text variable, and only when the ground needs it', () => {
    const lime = '#cbe84f';
    const onDark = formThemeVars({ background: '#222222', primaryColor: lime });
    const onWhite = formThemeVars({ background: '#ffffff', primaryColor: lime });
    // Dark ground: lime letters are legible, so ink is the untouched brand color.
    expect(onDark['--pf-primary-ink']).toBe(lime);
    // White ground: lime letters are not, so ink darkens — while the fill above
    // stayed exactly `#cbe84f`.
    expect(onWhite['--pf-primary-ink']).not.toBe(lime);
    expect(contrastRatio(onWhite['--pf-primary-ink']!, '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(onWhite['--pf-primary']).toBe(lime);
  });

  it('leaves ink alone for an accent that already reads on a light ground', () => {
    const blue = '#1f6feb';
    const vars = formThemeVars({ background: '#ffffff', primaryColor: blue });
    expect(vars['--pf-primary']).toBe(blue);
    expect(vars['--pf-primary-ink']).toBe(blue);
  });

  it('derives the supporting tokens from the author’s own two colors', () => {
    const vars = formThemeVars({ background: '#f7f2e9', foreground: '#2a241d' });
    expect(vars['--background']).toBe('#f7f2e9');
    expect(vars['--foreground']).toBe('#2a241d');
    // Mixed toward the text, so on a light ground the surfaces get darker.
    expect(vars['--card']).toBe('color-mix(in srgb, #2a241d 4%, #f7f2e9)');
    expect(vars['--border']).toBe('color-mix(in srgb, #2a241d 16%, #f7f2e9)');
    expect(vars['--muted-foreground']).toBe('color-mix(in srgb, #2a241d 62%, #f7f2e9)');
  });

  it('infers a readable foreground when only a background is set', () => {
    expect(formThemeVars({ background: '#ffffff' })['--foreground']).toBe('#1a1a1c');
    expect(formThemeVars({ background: '#0d0d0f' })['--foreground']).toBe('#fafafa');
  });

  it('clamps ink against the CHOSEN ground, not the default one', () => {
    const onLight = formThemeVars({ background: '#ffffff', primaryColor: '#f2f7c8' });
    expect(contrastRatio(onLight['--pf-primary-ink']!, '#ffffff')).toBeGreaterThanOrEqual(3);
  });
});
