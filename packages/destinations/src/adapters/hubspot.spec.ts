import { describe, it, expect } from 'vitest';
import {
  HubspotDestination,
  toHubSpotDateMs,
  buildSubmissionNoteBody,
  inferCompanyProperties,
} from './hubspot';
import type { DestinationContext } from '../destination.port';

function ctx(over: Partial<DestinationContext> = {}): DestinationContext {
  return {
    idempotencyKey: 'submission:sub-1:complete:hubspot',
    submissionId: 'sub-1',
    formId: 'form-1',
    formName: 'Lead Qualifier',
    accountId: 'acc-1',
    sessionId: 'sess-1',
    score: 18,
    outcomeLabel: 'Qualified',
    phase: 'complete',
    submittedAt: Date.UTC(2026, 0, 15, 22, 30), // 15 Jan 2026 22:30 UTC
    data: {
      contact_email: 'lead@acme.io',
      first: 'Ada',
      company: 'Acme',
      empty: '   ',
    },
    utm: { utm_source: 'google', utm_campaign: 'q1' },
    ...over,
  };
}

const MAPPING = {
  fieldMappings: { contact_email: 'email', first: 'firstname', company: 'company', empty: 'notes' },
  utmMappings: { utm_source: 'hs_analytics_source', utm_campaign: 'utm_campaign_prop' },
  scoreProperty: 'lead_score',
  dateProperty: 'submitted_date',
};

describe('toHubSpotDateMs', () => {
  it('truncates an instant to UTC midnight (date property contract)', () => {
    expect(toHubSpotDateMs(Date.UTC(2026, 0, 15, 22, 30))).toBe(String(Date.UTC(2026, 0, 15)));
  });
});

describe('HubspotDestination.buildProperties', () => {
  it('maps fields + UTM + score + date, dropping empty values', () => {
    const dest = new HubspotDestination({ token: 't', ...MAPPING });
    const props = dest.buildProperties(ctx());
    expect(props.firstname).toBe('Ada');
    expect(props.company).toBe('Acme');
    expect(props.notes).toBeUndefined(); // whitespace-only dropped
    expect(props.hs_analytics_source).toBe('google');
    expect(props.utm_campaign_prop).toBe('q1');
    expect(props.lead_score).toBe('18');
    expect(props.submitted_date).toBe(String(Date.UTC(2026, 0, 15)));
  });

  // One answer, several properties. The workaround before this was a SECOND
  // hubspot destination — which the integrations screen cannot see and the
  // booking sync never delivers, so it wrote nothing at all.
  it('fans one answer out to every property it targets', () => {
    const dest = new HubspotDestination({
      token: 't',
      fieldMappings: { goal: ['typeform_use_case', 'goal_ai_agent'], name: 'firstname' },
      valueMaps: { goal: { leads_frios: 'AI Calls' } },
    });
    const props = dest.buildProperties(ctx({ data: { goal: 'leads_frios', name: 'Ada' } }));
    // The value map is per STEP, so both properties receive the TRANSLATED
    // value — sending the raw slug to one of them is the bug this replaces.
    expect(props.typeform_use_case).toBe('AI Calls');
    expect(props.goal_ai_agent).toBe('AI Calls');
    expect(props.firstname).toBe('Ada'); // a plain string still maps
  });

  it('resolves email when it is one of several properties an answer feeds', () => {
    const dest = new HubspotDestination({
      token: 't',
      fieldMappings: { work: ['email', 'work_email'] },
    });
    expect(dest.resolveEmail(ctx({ data: { work: 'lead@acme.io' } }))).toBe('lead@acme.io');
  });

  it('drops blank targets instead of writing an empty property name', () => {
    const dest = new HubspotDestination({
      token: 't',
      fieldMappings: { name: ['  ', 'firstname'], other: '   ' },
    });
    const props = dest.buildProperties(ctx({ data: { name: 'Ada', other: 'x' } }));
    expect(props.firstname).toBe('Ada');
    expect(Object.keys(props)).not.toContain('');
  });

  it('omits the score property on a partial submission', () => {
    const dest = new HubspotDestination({ token: 't', ...MAPPING });
    expect(dest.buildProperties(ctx({ phase: 'partial' })).lead_score).toBeUndefined();
  });

  it('resolves email from the mapping, then from raw data', () => {
    const dest = new HubspotDestination({ token: 't', ...MAPPING });
    expect(dest.resolveEmail(ctx())).toBe('lead@acme.io');
    const dest2 = new HubspotDestination({ token: 't', fieldMappings: {} });
    expect(dest2.resolveEmail(ctx({ data: { email: 'x@y.io' } }))).toBe('x@y.io');
    expect(dest2.resolveEmail(ctx({ data: {} }))).toBeNull();
  });

  // --- Pilot extras: value maps ---------------------------------------------

  it('translates a mapped answer through its value map (picklist label)', () => {
    const dest = new HubspotDestination({
      token: 't',
      fieldMappings: { use_case: 'typeform_use_case' },
      valueMaps: { use_case: { leads_frios: 'AI Calls', whatsapp: 'AI Text' } },
    });
    const props = dest.buildProperties(ctx({ data: { use_case: 'leads_frios' } }));
    expect(props.typeform_use_case).toBe('AI Calls');
  });

  it('passes an unmapped raw value through unchanged', () => {
    const dest = new HubspotDestination({
      token: 't',
      fieldMappings: { use_case: 'typeform_use_case', first: 'firstname' },
      valueMaps: { use_case: { leads_frios: 'AI Calls' } },
    });
    const props = dest.buildProperties(ctx({ data: { use_case: 'something_else', first: 'Ada' } }));
    expect(props.typeform_use_case).toBe('something_else'); // no entry -> passthrough
    expect(props.firstname).toBe('Ada'); // step without a value map untouched
  });

  // --- Pilot extras: outcome property ---------------------------------------

  it('writes the outcome label to outcomeProperty on complete only', () => {
    const dest = new HubspotDestination({
      token: 't',
      fieldMappings: {},
      outcomeProperty: 'qualification',
    });
    expect(dest.buildProperties(ctx()).qualification).toBe('Qualified');
    expect(dest.buildProperties(ctx({ phase: 'partial' })).qualification).toBeUndefined();
    expect(dest.buildProperties(ctx({ outcomeLabel: null })).qualification).toBeUndefined();
  });

  // --- Pilot extras: static properties --------------------------------------

  it('merges staticProperties on complete without overwriting mapped values', () => {
    const dest = new HubspotDestination({
      token: 't',
      fieldMappings: { company: 'company' },
      staticProperties: { optin_form: 'true', company: 'StaticCo' },
    });
    const props = dest.buildProperties(ctx());
    expect(props.optin_form).toBe('true'); // fills the hole
    expect(props.company).toBe('Acme'); // mapped answer wins over static
  });

  it('omits staticProperties on a partial submission', () => {
    const dest = new HubspotDestination({
      token: 't',
      fieldMappings: {},
      staticProperties: { optin_form: 'true' },
    });
    expect(dest.buildProperties(ctx({ phase: 'partial' })).optin_form).toBeUndefined();
  });

  // --- Pilot extras: company/website inference ------------------------------

  it('infers company + website from a corporate email domain', () => {
    const dest = new HubspotDestination({
      token: 't',
      fieldMappings: { contact_email: 'email' },
      inferCompanyFromEmail: true,
    });
    const props = dest.buildProperties(ctx({ data: { contact_email: 'lead@acme.io' } }));
    expect(props.company).toBe('Acme');
    expect(props.website).toBe('https://acme.io');
  });

  it('skips inference for a free-mail domain', () => {
    const dest = new HubspotDestination({
      token: 't',
      fieldMappings: { contact_email: 'email' },
      inferCompanyFromEmail: true,
    });
    const props = dest.buildProperties(ctx({ data: { contact_email: 'lead@gmail.com' } }));
    expect(props.company).toBeUndefined();
    expect(props.website).toBeUndefined();
  });

  it('never overwrites a company/website already set by mappings', () => {
    const dest = new HubspotDestination({
      token: 't',
      fieldMappings: { contact_email: 'email', company: 'company' },
      inferCompanyFromEmail: true,
    });
    const props = dest.buildProperties(
      ctx({ data: { contact_email: 'lead@acme.io', company: 'Globex' } }),
    );
    expect(props.company).toBe('Globex'); // mapped answer wins
    expect(props.website).toBe('https://acme.io'); // the hole is still filled
  });
});

describe('inferCompanyProperties', () => {
  it('derives capitalized company + https website from a corporate domain', () => {
    expect(inferCompanyProperties('Lead@Acme.io')).toEqual({
      company: 'Acme',
      website: 'https://acme.io',
    });
  });

  it('returns null for free-mail domains and malformed addresses', () => {
    expect(inferCompanyProperties('a@gmail.com')).toBeNull();
    expect(inferCompanyProperties('a@hotmail.co.uk')).toBeNull(); // free-mail base
    expect(inferCompanyProperties('not-an-email')).toBeNull();
    expect(inferCompanyProperties('a@nodot')).toBeNull();
    expect(inferCompanyProperties(null)).toBeNull();
  });
});

describe('HubspotDestination.deliver', () => {
  it('upserts the contact and creates a Note on a completed submission', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) });
      if (url.includes('/contacts/batch/upsert'))
        return new Response(JSON.stringify({ results: [{ id: '501' }] }), { status: 200 });
      if (url.includes('/objects/notes')) return new Response('{}', { status: 201 });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const dest = new HubspotDestination({ token: 't', ...MAPPING }, fetchImpl);
    const res = await dest.deliver(ctx());
    expect(res.delivered).toBe(true);
    expect(res.detail).toContain('contact=501');
    expect(res.detail).toContain('+note');

    const upsert = calls.find((c) => c.url.includes('upsert'))!;
    const input = (upsert.body as { inputs: Array<{ idProperty: string; id: string; properties: Record<string, string> }> }).inputs[0]!;
    expect(input.idProperty).toBe('email');
    expect(input.id).toBe('lead@acme.io');
    expect(input.properties.email).toBe('lead@acme.io');
    expect(input.properties.lead_score).toBe('18');

    const note = calls.find((c) => c.url.includes('notes'))!;
    const noteBody = (note.body as { properties: { hs_note_body: string } }).properties.hs_note_body;
    expect(noteBody).toContain('Lead Qualifier');
    expect(noteBody).toContain('Qualified');
  });

  it('does NOT create a Note on a partial submission', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ results: [{ id: '9' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    await new HubspotDestination({ token: 't', ...MAPPING }, fetchImpl).deliver(ctx({ phase: 'partial' }));
    expect(urls.some((u) => u.includes('/notes'))).toBe(false);
  });

  it('strips a portal-rejected property and retries the upsert', async () => {
    let attempt = 0;
    const bodies: Record<string, string>[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      if (!url.includes('upsert')) return new Response('{}', { status: 201 });
      attempt++;
      const input = JSON.parse(init.body as string).inputs[0];
      bodies.push(input.properties);
      if (attempt === 1) {
        return new Response(
          JSON.stringify({
            errors: [{ code: 'PROPERTY_DOESNT_EXIST', context: { propertyName: ['lead_score'] } }],
          }),
          { status: 400 },
        );
      }
      return new Response(JSON.stringify({ results: [{ id: '7' }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const res = await new HubspotDestination({ token: 't', ...MAPPING }, fetchImpl).deliver(ctx());
    expect(attempt).toBe(2);
    expect(bodies[0]!.lead_score).toBe('18'); // first attempt included it
    expect(bodies[1]!.lead_score).toBeUndefined(); // retry stripped it
    expect(res.detail).toContain('skipped=[lead_score]');
  });

  it('is a permanent no-op (delivered:false) when the submission has no email', async () => {
    const fetchImpl = (async () => {
      throw new Error('should not be called');
    }) as unknown as typeof fetch;
    const dest = new HubspotDestination({ token: 't', fieldMappings: {} }, fetchImpl);
    const res = await dest.deliver(ctx({ data: { first: 'Ada' } }));
    expect(res.delivered).toBe(false);
    expect(res.detail).toContain('no email');
  });

  it('THROWS on a non-recoverable upsert failure so the outbox retries', async () => {
    const fetchImpl = (async () => new Response('boom', { status: 503 })) as unknown as typeof fetch;
    await expect(
      new HubspotDestination({ token: 't', ...MAPPING }, fetchImpl).deliver(ctx()),
    ).rejects.toThrow(/HTTP 503/);
  });
});

describe('buildSubmissionNoteBody', () => {
  it('HTML-escapes user values (no injection into the note)', () => {
    const body = buildSubmissionNoteBody(
      { firstname: '<script>alert(1)</script>' },
      { formName: 'F', score: 1, outcomeLabel: null, submittedAt: 0 },
    );
    expect(body).not.toContain('<script>');
    expect(body).toContain('&lt;script&gt;');
  });
});
