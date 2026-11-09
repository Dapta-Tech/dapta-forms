import { describe, expect, it, vi } from 'vitest';
import type { FormBranding } from '@quill/engine';

// `next/font/google` resolves at build time and has no runtime in vitest.
vi.mock('next/font/google', () => {
  const font = () => ({ className: 'font', variable: '--font', style: { fontFamily: 'font' } });
  return {
    DM_Sans: font,
    Figtree: font,
    Fraunces: font,
    Hanken_Grotesk: font,
    JetBrains_Mono: font,
    Inter: font,
    Manrope: font,
    Playfair_Display: font,
    Poppins: font,
    Space_Grotesk: font,
    Work_Sans: font,
  };
});

import { formDesignProps } from './form-design';

const vars = (branding: FormBranding) => formDesignProps(branding).style as Record<string, string>;

describe('formDesignProps: button text color', () => {
  const base: FormBranding = { primaryColor: '#009DFF', background: '#ffffff' };

  it('without buttonTextColor the style has no --pf-btn-text and is unchanged', () => {
    const style = vars(base);
    expect('--pf-btn-text' in style).toBe(false);
    expect(vars({ ...base, buttonTextColor: null })).toEqual(style);
  });

  it('an absent buttonStyle resolves to solid and takes the color', () => {
    expect(vars({ ...base, buttonTextColor: '#ffffff' })['--pf-btn-text']).toBe('#ffffff');
  });

  it('outline and soft ignore it', () => {
    expect('--pf-btn-text' in vars({ ...base, buttonStyle: 'outline', buttonTextColor: '#ffffff' })).toBe(false);
    expect('--pf-btn-text' in vars({ ...base, buttonStyle: 'soft', buttonTextColor: '#ffffff' })).toBe(false);
  });

  it('a blank value counts as absent', () => {
    expect('--pf-btn-text' in vars({ ...base, buttonTextColor: '   ' })).toBe(false);
  });
});
