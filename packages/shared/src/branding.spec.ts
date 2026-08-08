import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACCENT,
  DEFAULT_CANVAS,
  clampAccent,
  contrastGrade,
  contrastRatio,
  formThemeVars,
  isLightColor,
  suggestReadable,
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

describe('isLightColor / readableOn / resolveThemeMode', () => {
  it('classifies grounds', () => {
    expect(isLightColor('#ffffff')).toBe(true);
    expect(isLightColor('#faf9f6')).toBe(true);
    expect(isLightColor('#222222')).toBe(false);
    expect(isLightColor('#16121f')).toBe(false);
  });

  it('suggests a readable text color for a ground', () => {
    // Both ends are the palette's own text colors, not #000/#fff — a custom
    // background should still land the author inside the system.
    expect(readableOn('#ffffff')).toBe('#0d1013');
    expect(readableOn('#111111')).toBe('#e8edf2');
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

  it('NEVER substitutes the author’s color, on any ground', () => {
    // The whole policy in one test: a silently corrected color reads as a bug —
    // you set lime, the page shows olive, and nothing explains it. Legibility is
    // handled by warning in the editor, not by overriding the choice here.
    const lime = '#cbe84f';
    for (const ground of ['#222222', '#ffffff', '#f7f2e9', '#0d0d0f']) {
      expect(formThemeVars({ background: ground, primaryColor: lime })['--pf-primary']).toBe(lime);
    }
    expect(formThemeVars({ primaryColor: lime })['--pf-primary']).toBe(lime);
  });

  it('still picks the button label for contrast — that is the renderer’s call', () => {
    // Nobody chooses the color of button text, so deriving it is not an override.
    const lime = '#cbe84f';
    const vars = formThemeVars({ background: '#ffffff', primaryColor: lime });
    expect(vars['--pf-primary-contrast']).toBe(onAccent(lime));
    expect(contrastRatio(onAccent(lime), lime)).toBeGreaterThanOrEqual(4.5);
  });

  it('emits no accent-ink variable — nothing is clamped at render time', () => {
    const vars = formThemeVars({ background: '#ffffff', primaryColor: '#cbe84f' });
    expect(vars['--pf-primary-ink']).toBeUndefined();
  });

  it('guarantees an AA button label on a mid-luminance accent, not a best-of-two', () => {
    // The regression this exists for: the seeded demo form's indigo put the fixed
    // Lime Ink at 4.35:1, and the other fixed end (near-white) lands at 4.56 — so
    // "pick the better constant" was a coin flip between a fail and a near-fail.
    const indigo = '#6366f1';
    expect(contrastRatio('#0c0e07', indigo)).toBeLessThan(4.5); // the old answer
    expect(contrastRatio(onAccent(indigo), indigo)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the palette’s own ink verbatim whenever it already clears AA', () => {
    // The walk is a fallback, not a filter: the house lime must still return the
    // exact Lime Ink constant, or every default button label shifts hue slightly.
    expect(onAccent(DEFAULT_ACCENT)).toBe('#0c0e07');
    expect(onAccent('#cbe84f')).toBe('#0c0e07');
  });

  it('reaches AA on every accent a preset can ship', () => {
    for (const accent of ['#cbe84f', '#d3e750', '#2b6e4f', '#e0b64f', '#1f6feb', '#f2704a', '#6dd39a', '#b5533a', '#a78bfa', '#6366f1']) {
      expect(contrastRatio(onAccent(accent), accent), accent).toBeGreaterThanOrEqual(4.5);
    }
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
    expect(formThemeVars({ background: '#ffffff' })['--foreground']).toBe('#0d1013');
    expect(formThemeVars({ background: '#0d0d0f' })['--foreground']).toBe('#e8edf2');
  });

  it('passes even an unreadable accent straight through', () => {
    // The editor warns about this pair; the renderer still honours it.
    const pastel = '#f2f7c8';
    const vars = formThemeVars({ background: '#ffffff', primaryColor: pastel });
    expect(vars['--pf-primary']).toBe(pastel);
    expect(contrastRatio(pastel, '#ffffff')).toBeLessThan(3);
  });
});

describe('suggestReadable', () => {
  it('returns null when the pair already reads', () => {
    expect(suggestReadable('#1f6feb', '#ffffff')).toBeNull();
    expect(suggestReadable('#cbe84f', '#222222')).toBeNull();
  });

  it('suggests a color that clears the threshold on a light ground', () => {
    const s = suggestReadable('#cbe84f', '#ffffff');
    expect(s).not.toBeNull();
    expect(contrastRatio(s!, '#ffffff')).toBeGreaterThanOrEqual(3);
  });

  it('suggests a color that clears the threshold on a dark ground', () => {
    const s = suggestReadable('#1a1a1a', '#222222');
    expect(s).not.toBeNull();
    expect(contrastRatio(s!, '#222222')).toBeGreaterThanOrEqual(3);
  });

  it('honours a custom minimum, so body text can ask for AA', () => {
    const s = suggestReadable('#8a8a8a', '#ffffff', 4.5);
    expect(s).not.toBeNull();
    expect(contrastRatio(s!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('returns null rather than throwing for a color it cannot parse', () => {
    expect(suggestReadable('rebeccapurple', '#ffffff')).toBeNull();
    expect(suggestReadable('#ffffff', 'not-a-color')).toBeNull();
  });
});
