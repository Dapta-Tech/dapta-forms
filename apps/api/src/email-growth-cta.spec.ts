import { describe, expect, it } from 'vitest';
import { emailGrowthCta } from './email-growth-cta';

describe('emailGrowthCta', () => {
  const on = { NEXT_PUBLIC_SIGNUP_URL: 'https://app.example.com', NEXT_PUBLIC_LANDING_URL: 'https://www.example.com/' };

  it('is off in a bare fork (no signup URL) and when the badge is hidden', () => {
    expect(emailGrowthCta({})({ locale: 'en', medium: 'email-receipt' })).toBeNull();
    expect(emailGrowthCta({ ...on, NEXT_PUBLIC_HIDE_BADGE: 'true' })({ locale: 'en', medium: 'email-receipt' })).toBeNull();
  });

  it('points at the landing, tagged with the email it sat in', () => {
    const cta = emailGrowthCta(on)({ locale: 'en', medium: 'email-notice' })!;
    const url = new URL(cta.href);
    expect(url.origin + url.pathname).toBe('https://www.example.com/');
    expect(url.searchParams.get('utm_medium')).toBe('email-notice');
    expect(url.searchParams.get('utm_campaign')).toBe('made-with-dforms');
  });

  it("speaks the email's language", () => {
    expect(emailGrowthCta(on)({ locale: 'es', medium: 'email-receipt' })).toMatchObject({
      question: '¿Quieres tu propio formulario?',
      action: 'Crea tu formulario gratis',
    });
    expect(emailGrowthCta(on)({ locale: 'en', medium: 'email-receipt' })).toMatchObject({
      question: 'Want your own form?',
      action: 'Create your form, free',
    });
  });
});
