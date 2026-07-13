import { describe, it, expect } from 'vitest';
import { HubspotDestination, toHubSpotDateMs, buildSubmissionNoteBody } from './hubspot';
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
