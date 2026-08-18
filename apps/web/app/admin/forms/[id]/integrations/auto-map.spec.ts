import { describe, expect, it } from 'vitest';
import { propertyLookup, suggestProperty, type QuestionMeta } from './auto-map';

/** A representative slice of a real HubSpot contact-property list. */
const HUBSPOT = propertyLookup([
  { name: 'email' },
  { name: 'firstname' },
  { name: 'lastname' },
  { name: 'phone' },
  { name: 'mobilephone' },
  { name: 'company' },
  { name: 'website' },
  { name: 'jobtitle' },
]);

const q = (partial: Partial<QuestionMeta> & { key: string }): QuestionMeta => ({
  label: partial.key,
  type: 'text',
  ...partial,
});

describe('suggestProperty', () => {
  it('maps email by field type and by key/label', () => {
    expect(suggestProperty(q({ key: 'work_email', type: 'email' }), HUBSPOT)).toBe('email');
    expect(suggestProperty(q({ key: 'contact', label: 'Your Email' }), HUBSPOT)).toBe('email');
    expect(suggestProperty(q({ key: 'correo', label: 'Correo electrónico' }), HUBSPOT)).toBe('email');
  });

  it('prefers mobilephone over phone for phone questions', () => {
    expect(suggestProperty(q({ key: 'phone', type: 'phone' }), HUBSPOT)).toBe('mobilephone');
    expect(suggestProperty(q({ key: 'whatsapp', label: 'WhatsApp number' }), HUBSPOT)).toBe(
      'mobilephone',
    );
  });

  it('falls back to phone when mobilephone is absent', () => {
    const noMobile = propertyLookup([{ name: 'phone' }]);
    expect(suggestProperty(q({ key: 'telefono', type: 'phone' }), noMobile)).toBe('phone');
  });

  it('distinguishes first/last name and maps a generic name to firstname', () => {
    expect(suggestProperty(q({ key: 'first_name' }), HUBSPOT)).toBe('firstname');
    expect(suggestProperty(q({ key: 'last_name' }), HUBSPOT)).toBe('lastname');
    expect(suggestProperty(q({ key: 'apellido', label: 'Apellido' }), HUBSPOT)).toBe('lastname');
    expect(suggestProperty(q({ key: 'name', type: 'name' }), HUBSPOT)).toBe('firstname');
  });

  it('maps company and website (EN + ES synonyms)', () => {
    expect(suggestProperty(q({ key: 'company', label: 'Company' }), HUBSPOT)).toBe('company');
    expect(suggestProperty(q({ key: 'empresa' }), HUBSPOT)).toBe('company');
    expect(suggestProperty(q({ key: 'website', label: 'Your website URL' }), HUBSPOT)).toBe('website');
    expect(suggestProperty(q({ key: 'sitio_web' }), HUBSPOT)).toBe('website');
    // "company website" is a website, not a company (website wins the tie).
    expect(suggestProperty(q({ key: 'website', label: "What's your company website?" }), HUBSPOT)).toBe(
      'website',
    );
  });

  it('maps a url question to website by field type alone', () => {
    // The key/label say nothing about a website; the type is what decides.
    expect(suggestProperty(q({ key: 'url_1', label: 'Where can we find you?', type: 'url' }), HUBSPOT)).toBe(
      'website',
    );
    // A url question whose label mentions the company still lands on website.
    expect(suggestProperty(q({ key: 'company', label: 'Company', type: 'url' }), HUBSPOT)).toBe('website');
  });

  it('returns the portal casing, not the guessed lowercase', () => {
    const cased = propertyLookup([{ name: 'MobilePhone' }]);
    expect(suggestProperty(q({ key: 'phone', type: 'phone' }), cased)).toBe('MobilePhone');
  });

  it('returns null when nothing sensible matches or the property is absent', () => {
    expect(suggestProperty(q({ key: 'favorite_color', label: 'Favorite color' }), HUBSPOT)).toBeNull();
    // "company" synonym matches, but the portal has no company property → null.
    expect(suggestProperty(q({ key: 'company' }), propertyLookup([{ name: 'email' }]))).toBeNull();
  });
});
