/** Unit tests for the pure booking-embed URL builders. */
import { describe, expect, it } from 'vitest';
import {
  resolveSchedulerPrefill,
  buildBookingEmbedUrl,
  buildCalendlyEmbedUrl,
  buildCalendlyWidgetPrefill,
  buildDcalEmbedUrl,
  buildHubSpotMeetingsUrl,
  calendlyPrefillMessagePayload,
  extractBookingContactFields,
} from './booking-prefill';

const ANSWERS = {
  firstname: 'Ada',
  lastname: 'Lovelace',
  email: 'ada@example.com',
  phone: '+57 300 123 4567',
};

describe('extractBookingContactFields', () => {
  it('distills and trims the contact fields', () => {
    const fields = extractBookingContactFields({
      firstname: '  Ada ',
      lastname: 'Lovelace',
      email: ' ada@example.com ',
      phone: '+57 300',
    });
    expect(fields).toEqual({
      firstname: 'Ada',
      lastname: 'Lovelace',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '+57 300',
    });
  });

  it('falls back to the mobilephone alias and tolerates missing keys', () => {
    expect(extractBookingContactFields({ mobilephone: '3001234567' }).phone).toBe('3001234567');
    expect(extractBookingContactFields({})).toEqual({
      firstname: '',
      lastname: '',
      name: '',
      email: '',
      phone: '',
    });
  });
});

describe('buildHubSpotMeetingsUrl', () => {
  it('appends embed=true and the CRM contact params', () => {
    const url = new URL(buildHubSpotMeetingsUrl('https://meetings.hubspot.com/dapta/demo', ANSWERS));
    expect(url.origin + url.pathname).toBe('https://meetings.hubspot.com/dapta/demo');
    expect(url.searchParams.get('embed')).toBe('true');
    expect(url.searchParams.get('firstname')).toBe('Ada');
    expect(url.searchParams.get('lastname')).toBe('Lovelace');
    expect(url.searchParams.get('email')).toBe('ada@example.com');
    expect(url.searchParams.get('phone')).toBe('+57 300 123 4567');
  });

  it('keeps an existing query string and never double-appends', () => {
    const out = buildHubSpotMeetingsUrl(
      'https://meetings.hubspot.com/dapta/demo?uuid=abc&email=old@example.com',
      ANSWERS,
    );
    const url = new URL(out);
    expect(url.searchParams.get('uuid')).toBe('abc');
    expect(url.searchParams.getAll('email')).toEqual(['ada@example.com']);
    expect(url.searchParams.getAll('embed')).toEqual(['true']);
  });

  it('omits contact params when prefill is off (embed=true stays)', () => {
    const url = new URL(
      buildHubSpotMeetingsUrl('https://meetings.hubspot.com/dapta/demo', ANSWERS, {
        prefill: false,
      }),
    );
    expect(url.searchParams.get('embed')).toBe('true');
    expect(url.searchParams.has('firstname')).toBe(false);
    expect(url.searchParams.has('email')).toBe(false);
  });

  it('skips empty contact fields instead of sending blank params', () => {
    const url = new URL(buildHubSpotMeetingsUrl('https://meetings.hubspot.com/d/x', {}));
    expect(url.searchParams.has('firstname')).toBe(false);
    expect(url.searchParams.has('phone')).toBe(false);
  });
});

describe('buildCalendlyEmbedUrl', () => {
  it('appends embed params and prefill params', () => {
    const url = new URL(
      buildCalendlyEmbedUrl('https://calendly.com/dapta/intro', ANSWERS, {
        embedDomain: 'forms.example.com',
      }),
    );
    expect(url.searchParams.get('embed_domain')).toBe('forms.example.com');
    expect(url.searchParams.get('embed_type')).toBe('Inline');
    expect(url.searchParams.get('hide_gdpr_banner')).toBe('1');
    expect(url.searchParams.get('first_name')).toBe('Ada');
    expect(url.searchParams.get('last_name')).toBe('Lovelace');
    expect(url.searchParams.get('name')).toBe('Ada Lovelace');
    expect(url.searchParams.get('email')).toBe('ada@example.com');
    expect(url.searchParams.get('a1')).toBe('+57 300 123 4567');
    // Nothing of the form's own rides in a campaign parameter.
    expect(url.searchParams.has('utm_content')).toBe(false);
  });

  it('keeps an existing query and overwrites duplicates instead of appending', () => {
    const out = buildCalendlyEmbedUrl(
      'https://calendly.com/dapta/intro?month=2026-08&name=Old',
      ANSWERS,
      { embedDomain: 'x.test' },
    );
    const url = new URL(out);
    expect(url.searchParams.get('month')).toBe('2026-08');
    expect(url.searchParams.getAll('name')).toEqual(['Ada Lovelace']);
  });

  it('omits contact prefill when prefill is off but keeps the embed params', () => {
    const url = new URL(
      buildCalendlyEmbedUrl('https://calendly.com/dapta/intro', ANSWERS, {
        prefill: false,
        embedDomain: 'x.test',
        utm: { utm_content: 'ad-3' },
      }),
    );
    expect(url.searchParams.get('embed_type')).toBe('Inline');
    expect(url.searchParams.has('email')).toBe(false);
    expect(url.searchParams.has('name')).toBe(false);
    // The campaign is not an answer: prefill off does not drop it.
    expect(url.searchParams.get('utm_content')).toBe('ad-3');
  });

  it('carries the visitor campaign, utm_content included, instead of a session id', () => {
    const url = new URL(
      buildCalendlyEmbedUrl('https://calendly.com/dapta/intro', ANSWERS, {
        embedDomain: 'x.test',
        utm: { utm_source: 'linkedin', utm_content: 'carousel-2', ref: 'x' },
      }),
    );
    expect(url.searchParams.get('utm_source')).toBe('linkedin');
    expect(url.searchParams.get('utm_content')).toBe('carousel-2');
    // Only the five campaign keys travel.
    expect(url.searchParams.has('ref')).toBe(false);
  });

  it('keeps a utm_* the author wrote into the booking link', () => {
    const url = new URL(
      buildCalendlyEmbedUrl('https://calendly.com/dapta/intro?UTM_CONTENT=booking-link', ANSWERS, {
        utm: { utm_content: 'carousel-2', utm_medium: 'paid' },
      }),
    );
    expect(url.searchParams.getAll('UTM_CONTENT')).toEqual(['booking-link']);
    expect(url.searchParams.has('utm_content')).toBe(false);
    expect(url.searchParams.get('utm_medium')).toBe('paid');
  });

  it('omits embed_domain and utm_content when they are not provided', () => {
    const url = new URL(buildCalendlyEmbedUrl('https://calendly.com/dapta/intro', {}));
    expect(url.searchParams.has('embed_domain')).toBe(false);
    expect(url.searchParams.has('utm_content')).toBe(false);
  });
});

describe('buildCalendlyWidgetPrefill', () => {
  it('builds the widget prefill object from the answers', () => {
    expect(buildCalendlyWidgetPrefill(ANSWERS)).toEqual({
      name: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      customAnswers: { a1: '+57 300 123 4567' },
    });
  });

  it('returns undefined when there is nothing to prefill', () => {
    expect(buildCalendlyWidgetPrefill({})).toBeUndefined();
  });
});

describe('buildBookingEmbedUrl', () => {
  it('routes hubspot_meetings to the meetings builder', () => {
    const out = buildBookingEmbedUrl(
      { provider: 'hubspot_meetings', url: 'https://meetings.hubspot.com/d/x' },
      ANSWERS,
    );
    const url = new URL(out);
    expect(url.searchParams.get('embed')).toBe('true');
    expect(url.searchParams.get('email')).toBe('ada@example.com');
  });

  it('routes calendly to the calendly builder with the campaign + embed domain', () => {
    const out = buildBookingEmbedUrl(
      { provider: 'calendly', url: 'https://calendly.com/dapta/intro' },
      ANSWERS,
      { embedDomain: 'forms.example.com', utm: { utm_content: 'hero' } },
    );
    const url = new URL(out);
    expect(url.searchParams.get('utm_content')).toBe('hero');
    expect(url.searchParams.get('embed_domain')).toBe('forms.example.com');
    expect(url.searchParams.get('email')).toBe('ada@example.com');
  });

  it('honors prefill: false from the outcome config (default is on)', () => {
    const out = buildBookingEmbedUrl(
      { provider: 'calendly', url: 'https://calendly.com/dapta/intro', prefill: false },
      ANSWERS,
      { embedDomain: 'x.test' },
    );
    expect(new URL(out).searchParams.has('email')).toBe(false);
  });
});

describe('resolveSchedulerPrefill (V6 — scheduler field mapping)', () => {
  const CUSTOM = { quien: 'Ada Lovelace', correo: 'ada@acme.io', celular: '+13105551234' };

  it('feeds mapped questions into the conventional prefill keys', () => {
    const { answers } = resolveSchedulerPrefill(CUSTOM, { name: 'quien', email: 'correo' });
    expect(answers).toMatchObject({
      firstname: 'Ada',
      lastname: 'Lovelace',
      email: 'ada@acme.io',
    });
    // …so the existing widget builder picks them up unchanged.
    expect(buildCalendlyWidgetPrefill(answers)).toMatchObject({
      name: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@acme.io',
    });
  });

  it('sends a custom question as the EXACT positional id it was mapped to', () => {
    // The phone question is this event type's SECOND custom question, so it is
    // a2 — the old code always guessed a1, which silently filled nothing.
    const { customAnswers, answers } = resolveSchedulerPrefill(CUSTOM, { a2: 'celular' });
    expect(customAnswers).toEqual({ a2: '+13105551234' });
    // A custom question never leaks into the conventional keys.
    expect(answers.phone).toBeUndefined();
  });

  it('still honors a legacy `phone` mapping via the a1 slot', () => {
    const { answers, customAnswers } = resolveSchedulerPrefill(CUSTOM, { phone: 'celular' });
    expect(answers.phone).toBe('+13105551234');
    expect(customAnswers).toEqual({});
    expect(buildCalendlyWidgetPrefill(answers)?.customAnswers).toEqual({ a1: '+13105551234' });
  });

  it('leaves the answers untouched with no mapping (conventional keys still work)', () => {
    const answers = { firstname: 'Grace', email: 'grace@acme.io' };
    const out = resolveSchedulerPrefill(answers, undefined);
    expect(out.answers).toBe(answers);
    expect(out.customAnswers).toEqual({});
  });

  it('ignores entries that are unmapped or point at an empty answer', () => {
    const { answers, customAnswers } = resolveSchedulerPrefill(
      { firstname: 'Grace', correo: '', quien: '   ', vacio: '' },
      { name: 'quien', email: 'correo', a1: 'vacio' },
    );
    // Blank mapped answers never clobber what is already there.
    expect(answers.firstname).toBe('Grace');
    expect(answers.email).toBeUndefined();
    expect(customAnswers).toEqual({});
  });

  it('splits a single full-name answer into first and last', () => {
    const { answers } = resolveSchedulerPrefill({ q: 'Ada Byron King' }, { name: 'q' });
    expect(answers.firstname).toBe('Ada');
    expect(answers.lastname).toBe('Byron King');
  });
});

describe('resolveSchedulerPrefill — "Automatic" resolves by question TYPE', () => {
  // A form built in the builder: generated keys, none of them the conventional
  // firstname/email/phone the old extraction looked for.
  const STEPS = [
    { key: 'name_1', type: 'name', fields: ['firstname', 'lastname'] },
    { key: 'email_2', type: 'email' },
    { key: 'phone_3', type: 'phone' },
    { key: 'text_4', type: 'text' },
  ] as unknown as Parameters<typeof resolveSchedulerPrefill>[2];

  const ANSWERED = {
    firstname: 'Ada',
    lastname: 'Lovelace',
    email_2: 'ada@acme.io',
    phone_3: '+13105551234',
    text_4: 'ignore me',
  };

  it('fills email and phone from the answered questions, not a literal key', () => {
    const { answers } = resolveSchedulerPrefill(ANSWERED, undefined, STEPS);
    expect(answers.email).toBe('ada@acme.io');
    expect(answers.phone).toBe('+13105551234');
    expect(buildCalendlyWidgetPrefill(answers)).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@acme.io',
    });
  });

  it('an explicit mapping still wins over the automatic one', () => {
    const { answers } = resolveSchedulerPrefill(
      { ...ANSWERED, otro: 'mapped@acme.io' },
      { email: 'otro' },
      STEPS,
    );
    expect(answers.email).toBe('mapped@acme.io');
  });

  it('ignores a contact question that has not been answered yet', () => {
    // The email question sits after the scheduler, so it has no answer.
    const { answers } = resolveSchedulerPrefill({ firstname: 'Ada' }, undefined, STEPS);
    expect(answers.email).toBeUndefined();
    expect(answers.phone).toBeUndefined();
  });

  it('honors a name step whose subfield keys were renamed', () => {
    const steps = [
      { key: 'quien', type: 'name', fields: ['nombre', 'apellido'] },
    ] as unknown as Parameters<typeof resolveSchedulerPrefill>[2];
    const { answers } = resolveSchedulerPrefill(
      { nombre: 'Grace', apellido: 'Hopper' },
      undefined,
      steps,
    );
    expect(answers.firstname).toBe('Grace');
    expect(answers.lastname).toBe('Hopper');
  });

  it('leaves a conventional key alone when it is already filled', () => {
    const { answers } = resolveSchedulerPrefill(
      { email: 'primary@acme.io', email_2: 'secondary@acme.io' },
      undefined,
      STEPS,
    );
    expect(answers.email).toBe('primary@acme.io');
  });
});

describe('calendlyPrefillMessagePayload', () => {
  it('flattens the widget prefill into the calendly.prefill message payload', () => {
    expect(
      calendlyPrefillMessagePayload({
        name: 'Ada Lovelace',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        customAnswers: { a1: '+57 300', a3: 'Acme' },
      }),
    ).toEqual({
      name: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      a1: '+57 300',
      a3: 'Acme',
    });
  });

  it('carries the same fields the cold embed prefills from the answers', () => {
    expect(calendlyPrefillMessagePayload(buildCalendlyWidgetPrefill(ANSWERS))).toEqual({
      name: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      a1: '+57 300 123 4567',
    });
  });

  it('drops empty values and keys Calendly would not read', () => {
    expect(
      calendlyPrefillMessagePayload({ email: '', customAnswers: { a2: '', guests: 'x', a100: 'y' } }),
    ).toBeNull();
  });

  it('is null when there is nothing to prefill', () => {
    expect(calendlyPrefillMessagePayload(undefined)).toBeNull();
    expect(calendlyPrefillMessagePayload({})).toBeNull();
  });
});

// --- dCal ------------------------------------------------------------------
// Where dCal differs from Calendly, and why each difference has a test: its
// booking fields have real NAMES rather than positional ids, so the map is
// read by name; `notes` is one of the three fields its form asks by itself;
// and `phone` is NOT a built-in there, so an event type with a field named
// `phone` must be prefilled as that field and not routed to Calendly's legacy
// `a1` slot. Getting the last one wrong is silent: the booking just arrives
// with an empty phone.

const DCAL_URL = 'https://cal.example.test/acme/ana/intro-call';

describe('resolveSchedulerPrefill: dcal', () => {
  const answers = { ...ANSWERS, company_1: 'Example Co', notes_1: 'Sent from the form' };

  it('reads the map by field name, phone included', () => {
    const { answers: out, customAnswers } = resolveSchedulerPrefill(
      answers,
      { email: 'email', phone: 'phone', company: 'company_1' },
      undefined,
      'dcal',
    );
    expect(customAnswers).toEqual({ phone: '+57 300 123 4567', company: 'Example Co' });
    // `phone` stayed a named field: it must NOT have been treated as a built-in.
    expect(out.email).toBe('ada@example.com');
  });

  it('treats name, email and notes as the fields dCal asks by itself', () => {
    const { answers: out, customAnswers } = resolveSchedulerPrefill(
      answers,
      { notes: 'notes_1' },
      undefined,
      'dcal',
    );
    expect(out.notes).toBe('Sent from the form');
    expect(customAnswers).toEqual({});
  });

  it('still routes phone to the legacy slot for Calendly, the default', () => {
    const { customAnswers } = resolveSchedulerPrefill(answers, { phone: 'phone' }, undefined);
    expect(customAnswers).toEqual({});
  });
});

describe('buildDcalEmbedUrl', () => {
  const url = (...args: Parameters<typeof buildDcalEmbedUrl>) =>
    new URL(buildDcalEmbedUrl(...args)).searchParams;

  it('turns on embed mode and fills the three fields dCal asks by itself', () => {
    const q = url(DCAL_URL, { ...ANSWERS, notes: 'Sent from the form' });
    expect(q.get('embed')).toBe('1');
    expect(q.get('name')).toBe('Ada Lovelace');
    expect(q.get('email')).toBe('ada@example.com');
    expect(q.get('notes')).toBe('Sent from the form');
  });

  it('sends each of the event type’s own questions under its field name', () => {
    const q = url(DCAL_URL, ANSWERS, { customAnswers: { company: 'Example Co', phone: '+57 300' } });
    expect(q.get('answer_company')).toBe('Example Co');
    expect(q.get('answer_phone')).toBe('+57 300');
  });

  it('carries the visitor campaign utm_content, which dCal keeps on the booking', () => {
    const q = url(DCAL_URL, ANSWERS, { utm: { utm_campaign: 'launch', utm_content: 'video-a' } });
    expect(q.get('utm_campaign')).toBe('launch');
    expect(q.get('utm_content')).toBe('video-a');
  });

  it('never writes anything of its own into utm_content', () => {
    expect(url(DCAL_URL, ANSWERS).get('utm_content')).toBeNull();
    expect(url(`${DCAL_URL}?utm_content=link-tag`, ANSWERS, { utm: { utm_content: 'video-a' } }).get('utm_content')).toBe(
      'link-tag',
    );
  });

  it('keeps embed mode but sends no values when prefill is off', () => {
    const q = url(DCAL_URL, ANSWERS, { prefill: false, customAnswers: { company: 'Example Co' } });
    expect(q.get('embed')).toBe('1');
    expect(q.get('name')).toBeNull();
    expect(q.get('email')).toBeNull();
    expect(q.get('answer_company')).toBeNull();
  });

  it('leaves out a field with no answer rather than sending it blank', () => {
    const q = url(DCAL_URL, { email: 'ada@example.com' }, { customAnswers: { company: '' } });
    expect(q.get('email')).toBe('ada@example.com');
    expect(q.get('name')).toBeNull();
    expect(q.get('notes')).toBeNull();
    expect(q.get('answer_company')).toBeNull();
  });

  it('never double-appends onto a URL that already carries a query', () => {
    const built = buildDcalEmbedUrl(`${DCAL_URL}?embed=1&lang=es`, ANSWERS);
    expect(built.match(/embed=/g)).toHaveLength(1);
    expect(new URL(built).searchParams.get('lang')).toBe('es');
  });

  it('encodes a field name, which is the author’s text and not ours', () => {
    const built = buildDcalEmbedUrl(DCAL_URL, ANSWERS, { customAnswers: { 'a b&c': 'x' } });
    expect(built).not.toContain('a b&c');
    expect(new URL(built).searchParams.get('answer_a b&c')).toBe('x');
  });
});

describe('buildBookingEmbedUrl: dcal', () => {
  it('builds the dCal URL and passes the named answers through', () => {
    const q = new URL(
      buildBookingEmbedUrl(
        { provider: 'dcal', url: DCAL_URL, prefill: true },
        ANSWERS,
        { embedDomain: 'forms.example.test', customAnswers: { company: 'Example Co' }, utm: { utm_content: 'ad-1' } },
      ),
    ).searchParams;
    expect(q.get('embed')).toBe('1');
    expect(q.get('answer_company')).toBe('Example Co');
    expect(q.get('utm_content')).toBe('ad-1');
    // Calendly's parameter has no meaning here and must not be sent.
    expect(q.get('embed_domain')).toBeNull();
  });
});
