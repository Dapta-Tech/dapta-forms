import { describe, expect, it } from 'vitest';
import type { FormStep } from '@quill/engine';
import { getMessages } from '@quill/shared';
import { mappableQuestions, propertyLookup, suggestProperty, type QuestionMeta } from './auto-map';

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

describe('file questions', () => {
  it('suggests no property: a file answer has none it could fill', () => {
    expect(suggestProperty(q({ key: 'cv', label: 'Upload your CV', type: 'file' }), HUBSPOT)).toBeNull();
  });

  it('is not dragged into a mapping by the words in its question', () => {
    // "company logo" would otherwise match the `company` sweep and put a PDF
    // into a text property.
    expect(
      suggestProperty(q({ key: 'logo', label: 'Upload your company logo', type: 'file' }), HUBSPOT),
    ).toBeNull();
    expect(
      suggestProperty(q({ key: 'site', label: 'Attach your website export', type: 'file' }), HUBSPOT),
    ).toBeNull();
  });
});

/**
 * A `name` question stores its answer flat, under each sub-field (`firstname`,
 * `lastname`), never under its own key. The pickers used to offer the step key,
 * so mapping "Full name" to a CRM field wrote nothing on every delivery.
 */
describe('mappableQuestions', () => {
  const en = getMessages('en').admin.integrations;
  const es = getMessages('es').admin.integrations;
  const PARTS_EN = { first: en.nameFirstPart, last: en.nameLastPart };
  const PARTS_ES = { first: es.nameFirstPart, last: es.nameLastPart };
  const step = (s: Partial<FormStep> & Pick<FormStep, 'key' | 'type'>): FormStep => s as FormStep;

  it('offers a name question as its two stored answers, never its own key', () => {
    const out = mappableQuestions([step({ key: 'nombre_completo', type: 'name', question: 'Nombre y Apellido' })], PARTS_ES);
    expect(out).toEqual([
      { key: 'firstname', label: 'Nombre y Apellido · Nombre', type: 'name', namePart: 'first' },
      { key: 'lastname', label: 'Nombre y Apellido · Apellido', type: 'name', namePart: 'last' },
    ]);
    expect(out.map((q) => q.key)).not.toContain('nombre_completo');
  });

  it('marks a multiple-mode choice, and only that one', () => {
    const out = mappableQuestions(
      [
        step({ key: 'plans', type: 'multiple_choice', question: 'Plans', selectionMode: 'multiple' }),
        step({ key: 'plan', type: 'multiple_choice', question: 'Plan', selectionMode: 'single' }),
        step({ key: 'size', type: 'multiple_choice', question: 'Size' }),
      ],
      PARTS_EN,
    );
    expect(out).toEqual([
      { key: 'plans', label: 'Plans', type: 'multiple_choice', multiple: true },
      { key: 'plan', label: 'Plan', type: 'multiple_choice' },
      { key: 'size', label: 'Size', type: 'multiple_choice' },
    ]);
  });

  it('uses the step’s own sub-field labels when it has them', () => {
    const out = mappableQuestions(
      [step({ key: 'name', type: 'name', question: 'Full name', fieldLabels: { firstname: 'Given', lastname: '  ' } })],
      PARTS_EN,
    );
    // A blank label is no label: that half falls back to the catalog.
    expect(out.map((q) => q.label)).toEqual(['Full name · Given', `Full name · ${en.nameLastPart}`]);
  });

  it('follows custom sub-field keys, which is where those answers are stored', () => {
    const out = mappableQuestions([step({ key: 'who', type: 'name', question: 'Who', fields: ['nombre', 'apellidos'] })], PARTS_EN);
    expect(out.map((q) => [q.key, q.namePart])).toEqual([
      ['nombre', 'first'],
      ['apellidos', 'last'],
    ]);
  });

  it('keeps every other question as one entry, in form order, and leaves out messages', () => {
    const out = mappableQuestions(
      [
        step({ key: 'intro', type: 'message', question: 'Welcome' }),
        step({ key: 'email', type: 'email', question: 'Email' }),
        step({ key: 'name', type: 'name', question: '' }),
        step({ key: 'size', type: 'dropdown', question: '  ' }),
      ],
      PARTS_EN,
    );
    expect(out).toEqual([
      { key: 'email', label: 'Email', type: 'email' },
      // An untitled question is labelled by its key, as before.
      { key: 'firstname', label: `name · ${en.nameFirstPart}`, type: 'name', namePart: 'first' },
      { key: 'lastname', label: `name · ${en.nameLastPart}`, type: 'name', namePart: 'last' },
      { key: 'size', label: 'size', type: 'dropdown' },
    ]);
  });

  it('shows a question with recall tokens the way a respondent without that answer reads it', () => {
    const qs = mappableQuestions(
      [
        { key: 'name_1', type: 'name', question: 'What is your name?' } as FormStep,
        { key: 'email', type: 'email', question: 'Nice to meet you, [firstname]! What is your email?' } as FormStep,
        { key: 'role', type: 'text', question: '[firstname], what is your role?' } as FormStep,
        { key: 'only', type: 'text', question: '[firstname]' } as FormStep,
      ],
      PARTS_EN,
    );
    const label = (key: string) => qs.find((q) => q.key === key)?.label;
    expect(label('email')).toBe('Nice to meet you! What is your email?');
    expect(label('role')).toBe('What is your role?');
    // Nothing left but the token: the key keeps the row named.
    expect(label('only')).toBe('only');
    for (const q of qs) expect(q.label).not.toMatch(/\[[a-z0-9_]+\]/i);
  });

  it('leaves out reveal screens, which collect nothing', () => {
    const qs = mappableQuestions(
      [
        { key: 'email', type: 'email', question: 'Email' } as FormStep,
        { key: 'reveal_1', type: 'reveal', question: 'Your score' } as FormStep,
        { key: 'intro', type: 'message', question: 'Welcome' } as FormStep,
      ],
      PARTS_EN,
    );
    expect(qs.map((q) => q.key)).toEqual(['email']);
  });

  it('offers a key once when two questions store the same answer', () => {
    const out = mappableQuestions(
      [
        step({ key: 'a', type: 'name', question: 'First ask' }),
        step({ key: 'b', type: 'name', question: 'Second ask' }),
      ],
      PARTS_EN,
    );
    expect(out.map((q) => q.key)).toEqual(['firstname', 'lastname']);
    expect(out[0]!.label).toContain('First ask');
  });

  it('auto-maps the two halves to first name and last name, whatever the question says', () => {
    // "Apellido" is in both labels (the question names both halves), so a
    // keyword sweep alone would send the first name to `lastname`.
    const [first, last] = mappableQuestions([step({ key: 'n', type: 'name', question: 'Nombre y Apellido' })], PARTS_ES);
    expect(suggestProperty(first!, HUBSPOT)).toBe('firstname');
    expect(suggestProperty(last!, HUBSPOT)).toBe('lastname');
    const [cFirst, cLast] = mappableQuestions(
      [step({ key: 'n', type: 'name', question: 'Your company contact', fields: ['given', 'family'] })],
      PARTS_EN,
    );
    expect(suggestProperty(cFirst!, HUBSPOT)).toBe('firstname');
    expect(suggestProperty(cLast!, HUBSPOT)).toBe('lastname');
  });

  it('suggests nothing for a half the portal has no property for', () => {
    const [, last] = mappableQuestions([step({ key: 'n', type: 'name', question: 'Name' })], PARTS_EN);
    expect(suggestProperty(last!, propertyLookup([{ name: 'firstname' }]))).toBeNull();
  });
});
