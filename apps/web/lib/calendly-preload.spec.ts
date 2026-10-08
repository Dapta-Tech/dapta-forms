/** Unit tests for the pure parts of the hidden Calendly preloader. */
import { describe, expect, it } from 'vitest';
import {
  hasPreloadedCalendly,
  isPreloadableCalendlyUrl,
  parseCalendlyHeight,
  preloadCalendlyEmbeds,
  showPreloadedCalendly,
} from './calendly-preload';

describe('parseCalendlyHeight', () => {
  it('reads the px string Calendly posts, rounding up', () => {
    expect(parseCalendlyHeight('1121px')).toBe(1121);
    expect(parseCalendlyHeight('640.4px')).toBe(641);
    expect(parseCalendlyHeight(700)).toBe(700);
  });

  it('rejects anything that is not a positive size', () => {
    expect(parseCalendlyHeight(undefined)).toBeNull();
    expect(parseCalendlyHeight('auto')).toBeNull();
    expect(parseCalendlyHeight('0px')).toBeNull();
    expect(parseCalendlyHeight(-5)).toBeNull();
  });
});

describe('isPreloadableCalendlyUrl', () => {
  it('accepts only https://calendly.com pages', () => {
    expect(isPreloadableCalendlyUrl('https://calendly.com/d/aaaa/p1?x=1')).toBe(true);
    expect(isPreloadableCalendlyUrl('http://calendly.com/d/aaaa/p1')).toBe(false);
    expect(isPreloadableCalendlyUrl('https://calendly.com.evil.io/p1')).toBe(false);
    expect(isPreloadableCalendlyUrl('https://meetings.hubspot.com/ada')).toBe(false);
    expect(isPreloadableCalendlyUrl('not a url')).toBe(false);
  });
});

describe('on the server', () => {
  it('is inert: nothing boots, nothing is adoptable', () => {
    const stop = preloadCalendlyEmbeds(['https://calendly.com/acme/intro'], 'session-1');
    expect(() => stop()).not.toThrow();
    expect(hasPreloadedCalendly('https://calendly.com/acme/intro', 'session-1')).toBe(false);
    expect(
      showPreloadedCalendly('https://calendly.com/acme/intro', 'session-1', {} as HTMLElement, {
        onHeight: () => undefined,
        onShown: () => undefined,
        onUnavailable: () => undefined,
        onFail: () => undefined,
        prefill: null,
      }),
    ).toBeTypeOf('function');
  });
});
