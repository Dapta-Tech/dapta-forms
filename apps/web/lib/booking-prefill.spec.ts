/** Unit tests for the pure booking-embed URL builders. */
import { describe, expect, it } from 'vitest';
import {
  resolveSchedulerPrefill,
  buildBookingEmbedUrl,
  buildCalendlyEmbedUrl,
  buildCalendlyWidgetPrefill,
  buildHubSpotMeetingsUrl,
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
  it('appends embed params, prefill params, and the sessionId as utm_content', () => {
    const url = new URL(
      buildCalendlyEmbedUrl('https://calendly.com/dapta/intro', ANSWERS, {
        sessionId: 'sess-1',
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
    expect(url.searchParams.get('utm_content')).toBe('sess-1');
  });

  it('keeps an existing query and overwrites duplicates instead of appending', () => {
    const out = buildCalendlyEmbedUrl(
      'https://calendly.com/dapta/intro?month=2026-08&name=Old',
      ANSWERS,
      { sessionId: 'sess-2', embedDomain: 'x.test' },
    );
    const url = new URL(out);
    expect(url.searchParams.get('month')).toBe('2026-08');
    expect(url.searchParams.getAll('name')).toEqual(['Ada Lovelace']);
  });

  it('omits contact prefill when prefill is off but keeps the embed params', () => {
    const url = new URL(
      buildCalendlyEmbedUrl('https://calendly.com/dapta/intro', ANSWERS, {
        prefill: false,
        sessionId: 'sess-3',
        embedDomain: 'x.test',
      }),
    );
    expect(url.searchParams.get('embed_type')).toBe('Inline');
    expect(url.searchParams.has('email')).toBe(false);
    expect(url.searchParams.has('name')).toBe(false);
    expect(url.searchParams.get('utm_content')).toBe('sess-3');
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
      'sess-9',
    );
    const url = new URL(out);
    expect(url.searchParams.get('embed')).toBe('true');
    expect(url.searchParams.get('email')).toBe('ada@example.com');
  });

  it('routes calendly to the calendly builder with sessionId + embed domain', () => {
    const out = buildBookingEmbedUrl(
      { provider: 'calendly', url: 'https://calendly.com/dapta/intro' },
      ANSWERS,
      'sess-9',
      'forms.example.com',
    );
    const url = new URL(out);
    expect(url.searchParams.get('utm_content')).toBe('sess-9');
    expect(url.searchParams.get('embed_domain')).toBe('forms.example.com');
    expect(url.searchParams.get('email')).toBe('ada@example.com');
  });

  it('honors prefill: false from the outcome config (default is on)', () => {
    const out = buildBookingEmbedUrl(
      { provider: 'calendly', url: 'https://calendly.com/dapta/intro', prefill: false },
      ANSWERS,
      'sess-9',
      'x.test',
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
