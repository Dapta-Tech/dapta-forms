/**
 * The mirror form's shape.
 *
 * Every rule asserted here was measured against a real portal, because the
 * create endpoint's errors describe the problem poorly — it names a missing
 * field without saying which object wants it. These tests exist so the next
 * person does not have to re-derive the shape by bisecting 400s.
 */
import { describe, expect, it } from 'vitest';
import type { HubspotDestinationOptions } from './hubspot';
import {
  buildMirrorFormPayload,
  buildMirrorSubmission,
  labelForProperty,
  mirrorFormName,
  mirrorFormProperties,
  mirrorSubmitUrl,
} from './hubspot-form';

const CREATED_AT = '2026-08-13T00:00:00.000Z';

const opts = (over: Partial<HubspotDestinationOptions> = {}): HubspotDestinationOptions =>
  ({ token: 't', fieldMappings: {}, ...over }) as HubspotDestinationOptions;

describe('mirrorFormProperties', () => {
  it('always declares email, even with nothing mapped', () => {
    expect(mirrorFormProperties(opts())).toEqual(['email']);
  });

  it('collects every property the destination writes, email first', () => {
    const properties = mirrorFormProperties(
      opts({
        fieldMappings: { work_email: 'email', role: 'jobtitle' },
        utmMappings: { utm_source: 'dapta_source' },
        scoreProperty: 'lead_score',
        dateProperty: 'date_booking',
        outcomeProperty: 'lead_grade',
        staticProperties: { lifecyclestage: 'lead' },
      }),
    );
    expect(properties[0]).toBe('email');
    expect(properties).toEqual(
      expect.arrayContaining([
        'jobtitle',
        'dapta_source',
        'lead_score',
        'date_booking',
        'lead_grade',
        'lifecyclestage',
      ]),
    );
  });

  it('expands a question mapped to SEVERAL properties', () => {
    // `fieldMappings` values may be a string or an array; both reach the contact,
    // so both must reach the mirror or the activity under-reports.
    expect(mirrorFormProperties(opts({ fieldMappings: { phone: ['phone', 'mobilephone'] } }))).toEqual([
      'email',
      'phone',
      'mobilephone',
    ]);
  });

  it('declares a property once however many questions feed it', () => {
    const properties = mirrorFormProperties(
      opts({ fieldMappings: { a: 'notes', b: 'notes' }, staticProperties: { notes: 'x' } }),
    );
    expect(properties.filter((p) => p === 'notes')).toHaveLength(1);
  });

  it('leaves out the company/website enrichment, which only some respondents get', () => {
    // Declaring them would promise fields most submissions leave empty.
    const properties = mirrorFormProperties(opts({ inferCompanyFromEmail: true }));
    expect(properties).not.toContain('company');
    expect(properties).not.toContain('website');
  });

  it('drops a blank property name rather than sending one', () => {
    expect(mirrorFormProperties(opts({ scoreProperty: '   ' }))).toEqual(['email']);
  });
});

describe('buildMirrorFormPayload', () => {
  it('puts createdAt at the ROOT — the create endpoint demands it there', () => {
    const payload = buildMirrorFormPayload('Lead qualifier', ['email'], CREATED_AT);
    expect(payload.createdAt).toBe(CREATED_AT);
    expect(payload.formType).toBe('hubspot');
  });

  it('gives the email field a validation block and the text fields NONE', () => {
    // Measured: an email field without `validation` is rejected, and a text
    // field WITH one — even `{}` — is rejected too.
    const payload = buildMirrorFormPayload('F', ['email', 'jobtitle'], CREATED_AT);
    const [email, jobtitle] = payload.fieldGroups.map((g) => g.fields[0]!);
    expect(email!.fieldType).toBe('email');
    expect(email!.validation).toEqual({ blockedEmailDomains: [], useDefaultBlockList: false });
    expect(jobtitle!.fieldType).toBe('single_line_text');
    expect('validation' in jobtitle!).toBe(false);
  });

  it('declares every property as text, including ones the portal stores as picklists', () => {
    // Measured: submitting `COMPUTER_GAMES` through a text field lands the
    // internal value on an `enumeration` property. The property's own type
    // governs, so the mirror never has to track a portal's picklists.
    const payload = buildMirrorFormPayload('F', ['email', 'industry'], CREATED_AT);
    expect(payload.fieldGroups[1]!.fields[0]!.fieldType).toBe('single_line_text');
  });

  it('marks only the email required, since a mapped question may be optional', () => {
    const payload = buildMirrorFormPayload('F', ['email', 'jobtitle'], CREATED_AT);
    expect(payload.fieldGroups.map((g) => g.fields[0]!.required)).toEqual([true, false]);
  });

  it('claims no consent step of its own', () => {
    // The respondent consented on the Dapta form; the mirror is never rendered.
    expect(buildMirrorFormPayload('F', ['email'], CREATED_AT).legalConsentOptions).toEqual({
      type: 'none',
    });
  });

  it('creates the contact when the email is new to the portal', () => {
    // A lead form's whole point. Off, the submission would be dropped.
    const { configuration } = buildMirrorFormPayload('F', ['email'], CREATED_AT);
    expect(configuration.createNewContactForNewEmail).toBe(true);
  });
});

describe('mirrorFormName / labelForProperty', () => {
  it('says where the form came from', () => {
    expect(mirrorFormName('Lead qualifier')).toBe('Lead qualifier (Dapta Forms)');
  });

  it('truncates a long name instead of letting the create 400', () => {
    const name = mirrorFormName('x'.repeat(400));
    expect(name.length).toBeLessThanOrEqual(200);
    expect(name.endsWith(' (Dapta Forms)')).toBe(true);
  });

  it('still names an untitled form', () => {
    expect(mirrorFormName('')).toBe('Untitled form (Dapta Forms)');
  });

  it('reads a property name back as a label', () => {
    expect(labelForProperty('inbound_leads')).toBe('Inbound leads');
    expect(labelForProperty('email')).toBe('Email');
  });
});

describe('mirrorSubmitUrl', () => {
  it('uses the SECURE variant, the only one a private-app token may call', () => {
    expect(mirrorSubmitUrl('23824272', 'abc-123')).toBe(
      'https://api.hsforms.com/submissions/v3/integration/secure/submit/23824272/abc-123',
    );
  });
});

describe('buildMirrorSubmission', () => {
  it('sends the properties the mirror declares', () => {
    const body = buildMirrorSubmission(
      { email: 'a@b.com', jobtitle: 'CTO' },
      ['email', 'jobtitle'],
    );
    expect(body.fields).toEqual([
      { objectTypeId: '0-1', name: 'email', value: 'a@b.com' },
      { objectTypeId: '0-1', name: 'jobtitle', value: 'CTO' },
    ]);
  });

  it('drops a property the mirror does NOT declare', () => {
    // HubSpot rejects a submission naming a field the form lacks. Without this,
    // a mirror left stale by an edited mapping would fail outright rather than
    // record a slightly shorter activity.
    const body = buildMirrorSubmission({ email: 'a@b.com', added_later: 'x' }, ['email']);
    expect(body.fields.map((f) => f.name)).toEqual(['email']);
  });

  it('drops empty values, which would show as blank rows on the activity', () => {
    const body = buildMirrorSubmission({ email: 'a@b.com', jobtitle: '' }, ['email', 'jobtitle']);
    expect(body.fields.map((f) => f.name)).toEqual(['email']);
  });

  it('carries a page context when there is one, and omits the key when not', () => {
    expect(buildMirrorSubmission({ email: 'a@b.com' }, ['email'])).not.toHaveProperty('context');
    const withContext = buildMirrorSubmission({ email: 'a@b.com' }, ['email'], {
      pageUri: 'https://forms.example.com/x',
      pageName: 'Lead qualifier',
    });
    expect(withContext.context).toEqual({
      pageUri: 'https://forms.example.com/x',
      pageName: 'Lead qualifier',
    });
  });
});
