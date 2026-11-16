/**
 * Writing a submission to a Salesforce org.
 *
 * A fake Salesforce sits behind `fetch` and records every request, so each
 * spec states what the org RECEIVED, never how the adapter got there. The
 * weight is on three things that are cheap to get wrong and expensive to find
 * in a customer's CRM:
 *
 *   1. NO DUPLICATES. Contact first, then an unconverted Lead, then create; and
 *      a retry after a lost answer must PATCH what the first attempt created.
 *   2. WHICH FAILURES RETRY. An org's validation rule thrown would retry until
 *      the outbox gave up; a 503 resolved would lose the respondent.
 *   3. WHAT A FIELD RECEIVES. Numbers as numbers, a date as a day in the
 *      author's zone, Lead-only fields kept off a Contact.
 */
import { describe, expect, it, vi } from 'vitest';
import type { DestinationContext } from '../destination.port';
import { createDestination } from '../factory';
import {
  companyFromEmail,
  fieldValue,
  SALESFORCE_NOT_PROVIDED,
  SalesforceDestination,
  SalesforceHttpError,
  soqlString,
  type SalesforceDestinationOptions,
} from './salesforce';

const INSTANCE = 'https://acme.my.salesforce.com';

const ctx = (over: Partial<DestinationContext> = {}): DestinationContext => ({
  idempotencyKey: 'submission:s1:complete:salesforce:0',
  submissionId: 's1',
  formId: 'f1',
  formName: 'Lead qualifier',
  accountId: 'a1',
  sessionId: 'sess1',
  score: 42,
  outcomeLabel: null,
  phase: 'complete',
  submittedAt: Date.UTC(2026, 10, 17, 3, 30), // 17 Nov 03:30 UTC = 16 Nov in Bogota
  data: { email: 'sam@acme.io', name: 'Sam', last: 'Rivera', seats: '25', role: 'CTO' },
  utm: { utm_source: 'linkedin' },
  ...over,
});

const options = (over: Partial<SalesforceDestinationOptions> = {}): SalesforceDestinationOptions => ({
  accessToken: 'sf-token',
  instanceUrl: INSTANCE,
  fieldMappings: { email: 'Email', name: 'FirstName', last: 'LastName', seats: 'Seats__c', role: 'Title' },
  utmMappings: { utm_source: 'LeadSource_Detail__c' },
  leadFields: {
    Email: 'email',
    FirstName: 'string',
    LastName: 'string',
    Company: 'string',
    Title: 'string',
    Seats__c: 'double',
    LeadSource: 'picklist',
    LeadSource_Detail__c: 'string',
    Form_Score__c: 'double',
    Submitted__c: 'date',
    Submitted_At__c: 'datetime',
  },
  contactFields: { Email: 'email', FirstName: 'string', LastName: 'string', Title: 'string' },
  ...over,
});

interface Recorded {
  method: string;
  path: string;
  soql?: string;
  body?: Record<string, unknown>;
}

/**
 * A tiny Salesforce: answers SOQL from `contacts` / `leads` (ids by email) and
 * records writes. `fail` lets a spec make one route answer with an error.
 */
function fakeOrg(state: {
  contacts?: Record<string, string>;
  leads?: Record<string, string>;
  fail?: (req: Recorded) => { status: number; body: unknown } | null | 'network';
}) {
  const requests: Recorded[] = [];
  const contacts = { ...(state.contacts ?? {}) };
  const leads = { ...(state.leads ?? {}) };
  let next = 1;
  const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/services\/data\/v[\d.]+/, '');
    const req: Recorded = { method: init?.method ?? 'GET', path };
    if (path === '/query') req.soql = url.searchParams.get('q') ?? '';
    if (typeof init?.body === 'string') req.body = JSON.parse(init.body);
    requests.push(req);
    const failure = state.fail?.(req);
    if (failure === 'network') throw new TypeError('fetch failed');
    const reply = (status: number, body: unknown) =>
      ({ ok: status < 300, status, json: async () => body }) as unknown as Response;
    if (failure) return reply(failure.status, failure.body);

    if (req.soql) {
      const email = /Email = '([^']*)'/.exec(req.soql)?.[1] ?? '';
      const table = req.soql.includes('FROM Contact') ? contacts : leads;
      const id = table[email];
      return reply(200, { totalSize: id ? 1 : 0, records: id ? [{ Id: id }] : [] });
    }
    if (req.method === 'POST' && path === '/sobjects/Lead') {
      const id = `00Q${next++}`;
      leads[String(req.body?.Email)] = id;
      return reply(201, { id, success: true, errors: [] });
    }
    if (req.method === 'PATCH') return reply(204, null);
    return reply(404, [{ errorCode: 'NOT_FOUND', message: 'no route' }]);
  });
  return { fetchImpl, requests, leads };
}

const writes = (requests: Recorded[]) => requests.filter((r) => r.method !== 'GET');

describe('who the respondent already is', () => {
  it('updates the Contact when the email already belongs to one, and never creates a Lead', async () => {
    const org = fakeOrg({ contacts: { 'sam@acme.io': '003C1' }, leads: { 'sam@acme.io': '00QL1' } });
    const out = await new SalesforceDestination(options(), org.fetchImpl).deliver(ctx());

    expect(out).toMatchObject({ delivered: true, driver: 'salesforce', detail: 'updated Contact 003C1' });
    expect(writes(org.requests)).toEqual([
      {
        method: 'PATCH',
        path: '/sobjects/Contact/003C1',
        // Seats__c and the UTM field exist only on Lead: kept off the Contact.
        body: { FirstName: 'Sam', LastName: 'Rivera', Title: 'CTO', Email: 'sam@acme.io' },
      },
    ]);
  });

  it('updates the unconverted Lead when there is no Contact', async () => {
    const org = fakeOrg({ leads: { 'sam@acme.io': '00QL1' } });
    const out = await new SalesforceDestination(options(), org.fetchImpl).deliver(ctx());

    expect(out).toMatchObject({ delivered: true, detail: 'updated Lead 00QL1' });
    const [patch] = writes(org.requests);
    expect(patch).toMatchObject({ method: 'PATCH', path: '/sobjects/Lead/00QL1' });
    expect(patch!.body).toMatchObject({ Seats__c: 25, LeadSource_Detail__c: 'linkedin' });
  });

  it('looks for an UNCONVERTED Lead only, so a converted one is never written to', async () => {
    const org = fakeOrg({});
    await new SalesforceDestination(options(), org.fetchImpl).deliver(ctx());
    const leadQuery = org.requests.find((r) => r.soql?.includes('FROM Lead'));
    expect(leadQuery?.soql).toContain('IsConverted = false');
  });

  it('creates a Lead when the email is new', async () => {
    const org = fakeOrg({});
    const out = await new SalesforceDestination(options(), org.fetchImpl).deliver(ctx());

    expect(out).toMatchObject({ delivered: true, detail: 'created Lead 00Q1', responseStatus: 201 });
    expect(writes(org.requests)).toEqual([
      {
        method: 'POST',
        path: '/sobjects/Lead',
        body: {
          FirstName: 'Sam',
          LastName: 'Rivera',
          Seats__c: 25,
          Title: 'CTO',
          LeadSource_Detail__c: 'linkedin',
          Email: 'sam@acme.io',
          Company: 'Acme',
        },
      },
    ]);
  });

  it('a retry after a POST whose answer was lost updates what the first attempt created', async () => {
    const org = fakeOrg({});
    // The POST lands (the fake records the Lead), then the answer is lost.
    const losing = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const res = await org.fetchImpl(input, init);
      if (init?.method === 'POST') throw new TypeError('socket hang up');
      return res;
    });
    const dest = new SalesforceDestination(options(), losing);
    await expect(dest.deliver(ctx())).rejects.toBeInstanceOf(SalesforceHttpError);

    const retry = await new SalesforceDestination(options(), org.fetchImpl).deliver(ctx());
    expect(retry).toMatchObject({ delivered: true, detail: 'updated Lead 00Q1' });
    expect(org.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  });

  it('does not write anything when the submission has no email', async () => {
    const org = fakeOrg({});
    const out = await new SalesforceDestination(options(), org.fetchImpl).deliver(
      ctx({ data: { name: 'Sam', email: 'not-an-email' } }),
    );
    expect(out).toEqual({ delivered: false, driver: 'salesforce', detail: 'no email in submission' });
    expect(org.fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to a raw `email` answer when no question is mapped to Email', async () => {
    const org = fakeOrg({});
    await new SalesforceDestination(
      options({ fieldMappings: { name: 'FirstName' } }),
      org.fetchImpl,
    ).deliver(ctx());
    expect(writes(org.requests)[0]?.body).toMatchObject({ Email: 'sam@acme.io' });
  });

  it('escapes the email inside SOQL, so a quote cannot change the query', async () => {
    const org = fakeOrg({});
    await new SalesforceDestination(options(), org.fetchImpl).deliver(
      ctx({ data: { email: "o'brien@acme.io" } }),
    );
    expect(org.requests[0]?.soql).toContain("Email = 'o\\'brien@acme.io'");
  });
});

describe('required Lead fields on create', () => {
  it('fills LastName and Company with Salesforce\'s "[not provided]" when nothing supplies them', async () => {
    const org = fakeOrg({});
    await new SalesforceDestination(
      options({ fieldMappings: { email: 'Email' }, utmMappings: {} }),
      org.fetchImpl,
    ).deliver(ctx({ data: { email: 'sam@gmail.com' } }));
    expect(writes(org.requests)[0]?.body).toEqual({
      Email: 'sam@gmail.com',
      LastName: SALESFORCE_NOT_PROVIDED,
      Company: SALESFORCE_NOT_PROVIDED,
    });
  });

  it('never overwrites a mapped LastName or Company with a fallback', async () => {
    const org = fakeOrg({});
    await new SalesforceDestination(
      options({ fieldMappings: { email: 'Email', last: 'LastName', co: 'Company' } }),
      org.fetchImpl,
    ).deliver(ctx({ data: { email: 'sam@acme.io', last: 'Rivera', co: 'Acme Holdings' } }));
    expect(writes(org.requests)[0]?.body).toMatchObject({ LastName: 'Rivera', Company: 'Acme Holdings' });
  });

  it('does not fill required Lead fields on an update, where they already exist', async () => {
    const org = fakeOrg({ leads: { 'sam@acme.io': '00QL1' } });
    await new SalesforceDestination(options({ fieldMappings: { email: 'Email' } }), org.fetchImpl).deliver(ctx());
    expect(writes(org.requests)[0]?.body).not.toHaveProperty('Company');
    expect(writes(org.requests)[0]?.body).not.toHaveProperty('LastName');
  });
});

describe('what each field receives', () => {
  it('writes the submitted DAY in the author\'s zone to a date field', async () => {
    const org = fakeOrg({});
    await new SalesforceDestination(
      options({ dateField: 'Submitted__c', dayTimezone: 'America/Bogota' }),
      org.fetchImpl,
    ).deliver(ctx());
    expect(writes(org.requests)[0]?.body).toMatchObject({ Submitted__c: '2026-11-16' });
  });

  it('writes the exact instant to a datetime field', async () => {
    const org = fakeOrg({});
    await new SalesforceDestination(options({ dateField: 'Submitted_At__c' }), org.fetchImpl).deliver(ctx());
    expect(writes(org.requests)[0]?.body).toMatchObject({ Submitted_At__c: '2026-11-17T03:30:00.000Z' });
  });

  it('writes the score as a number', async () => {
    const org = fakeOrg({});
    await new SalesforceDestination(options({ scoreField: 'Form_Score__c' }), org.fetchImpl).deliver(ctx());
    expect(writes(org.requests)[0]?.body).toMatchObject({ Form_Score__c: 42 });
  });

  it('stamps static values only where no answer already wrote', async () => {
    const org = fakeOrg({});
    await new SalesforceDestination(
      options({ staticFields: { LeadSource: 'dForms', Title: 'Overwritten?' } }),
      org.fetchImpl,
    ).deliver(ctx());
    expect(writes(org.requests)[0]?.body).toMatchObject({ LeadSource: 'dForms', Title: 'CTO' });
  });

  it('fans one answer out to every field it is mapped to', async () => {
    const org = fakeOrg({});
    await new SalesforceDestination(
      options({ fieldMappings: { email: 'Email', role: ['Title', 'Role__c'] } }),
      org.fetchImpl,
    ).deliver(ctx());
    expect(writes(org.requests)[0]?.body).toMatchObject({ Title: 'CTO', Role__c: 'CTO' });
  });

  it('turns answers into the JSON its field type accepts', () => {
    expect(fieldValue('25', 'double')).toBe(25);
    expect(fieldValue('lots', 'double')).toBeUndefined();
    expect(fieldValue('Sí', 'boolean')).toBe(true);
    expect(fieldValue(['A', 'B'], 'multipicklist')).toBe('A;B');
    expect(fieldValue('  ', 'string')).toBeUndefined();
    expect(fieldValue(7, undefined)).toBe('7');
  });

  it('infers a company only from a corporate email', () => {
    expect(companyFromEmail('sam@acme.io')).toBe('Acme');
    expect(companyFromEmail('sam@gmail.com')).toBeNull();
    expect(companyFromEmail('sam@outlook.co')).toBeNull();
  });

  it('quotes SOQL strings', () => {
    expect(soqlString("a'b\\c")).toBe("'a\\'b\\\\c'");
  });
});

describe('which failures retry', () => {
  it("resolves an org's validation error with Salesforce's message, without retrying", async () => {
    const org = fakeOrg({
      fail: (req) =>
        req.method === 'POST'
          ? {
              status: 400,
              body: [
                {
                  errorCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION',
                  message: 'Phone is required for Enterprise leads',
                  fields: ['Phone'],
                },
              ],
            }
          : null,
    });
    const out = await new SalesforceDestination(options(), org.fetchImpl).deliver(ctx());
    expect(out).toMatchObject({
      delivered: false,
      driver: 'salesforce',
      responseStatus: 400,
      detail: 'HTTP 400: FIELD_CUSTOM_VALIDATION_EXCEPTION: Phone is required for Enterprise leads [Phone]',
    });
  });

  it('resolves a permission problem (403) instead of retrying it', async () => {
    const org = fakeOrg({
      fail: () => ({ status: 403, body: [{ errorCode: 'INSUFFICIENT_ACCESS', message: 'no access' }] }),
    });
    await expect(new SalesforceDestination(options(), org.fetchImpl).deliver(ctx())).resolves.toMatchObject({
      delivered: false,
      responseStatus: 403,
    });
  });

  it('throws on the API limit, a 403 that does pass with time', async () => {
    const org = fakeOrg({
      fail: () => ({ status: 403, body: [{ errorCode: 'REQUEST_LIMIT_EXCEEDED', message: 'TotalRequests Limit exceeded.' }] }),
    });
    await expect(new SalesforceDestination(options(), org.fetchImpl).deliver(ctx())).rejects.toMatchObject({
      status: 403,
    });
  });

  it('throws on a 503 and on a dead network', async () => {
    const down = fakeOrg({ fail: () => ({ status: 503, body: 'down' }) });
    await expect(new SalesforceDestination(options(), down.fetchImpl).deliver(ctx())).rejects.toBeInstanceOf(
      SalesforceHttpError,
    );
    const dead = fakeOrg({ fail: () => 'network' });
    await expect(new SalesforceDestination(options(), dead.fetchImpl).deliver(ctx())).rejects.toBeInstanceOf(
      SalesforceHttpError,
    );
  });

  it('on a 401 drops the cached token and throws, so the retry mints a new one', async () => {
    const onUnauthorized = vi.fn();
    const org = fakeOrg({ fail: () => ({ status: 401, body: [{ errorCode: 'INVALID_SESSION_ID', message: 'expired' }] }) });
    await expect(
      new SalesforceDestination(options({ onUnauthorized }), org.fetchImpl).deliver(ctx()),
    ).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

describe('the factory', () => {
  it('degrades to a named no-op when there is no usable connection', async () => {
    const org = fakeOrg({});
    const dest = createDestination(
      { type: 'salesforce', salesforce: options({ accessToken: '' }) },
      org.fetchImpl,
    );
    await expect(dest.deliver(ctx())).resolves.toMatchObject({
      delivered: false,
      driver: 'log-only',
    });
    expect(org.fetchImpl).not.toHaveBeenCalled();
  });

  it('builds the Salesforce adapter when connected', async () => {
    const org = fakeOrg({});
    const dest = createDestination({ type: 'salesforce', salesforce: options() }, org.fetchImpl);
    await expect(dest.deliver(ctx())).resolves.toMatchObject({ delivered: true, driver: 'salesforce' });
  });

  it('calls the org on its own instance URL and API version', async () => {
    const org = fakeOrg({});
    await new SalesforceDestination(options(), org.fetchImpl).deliver(ctx());
    const first = String(org.fetchImpl.mock.calls[0]?.[0]);
    expect(first.startsWith(`${INSTANCE}/services/data/v62.0/query?q=`)).toBe(true);
    const headers = org.fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sf-token');
  });
});

describe('refusals a retry can fix, and refusals that only mean "not here"', () => {
  it('retries lock contention, which Salesforce answers with a 400', async () => {
    const org = fakeOrg({
      fail: (req) =>
        req.method === 'POST'
          ? { status: 400, body: [{ errorCode: 'UNABLE_TO_LOCK_ROW', message: 'unable to obtain exclusive access' }] }
          : null,
    });
    await expect(new SalesforceDestination(options(), org.fetchImpl).deliver(ctx())).rejects.toMatchObject({
      status: 400,
    });
  });

  it('a Run As user who cannot see Contact still gets the Lead written', async () => {
    const org = fakeOrg({
      fail: (req) =>
        req.soql?.includes('FROM Contact')
          ? { status: 400, body: [{ errorCode: 'INVALID_TYPE', message: "sObject type 'Contact' is not supported." }] }
          : null,
    });
    const out = await new SalesforceDestination(options(), org.fetchImpl).deliver(ctx());
    expect(out).toMatchObject({ delivered: true, detail: 'created Lead 00Q1' });
  });

  it('retries when the matched record was deleted or converted before the write', async () => {
    const org = fakeOrg({
      leads: { 'sam@acme.io': '00QL1' },
      fail: (req) =>
        req.method === 'PATCH'
          ? { status: 400, body: [{ errorCode: 'CANNOT_UPDATE_CONVERTED_LEAD', message: 'converted' }] }
          : null,
    });
    await expect(new SalesforceDestination(options(), org.fetchImpl).deliver(ctx())).rejects.toBeInstanceOf(
      SalesforceHttpError,
    );
  });

  it('never leaks its classification code into the delivery result', async () => {
    const org = fakeOrg({
      fail: (req) =>
        req.method === 'POST' ? { status: 400, body: [{ errorCode: 'REQUIRED_FIELD_MISSING', message: 'x' }] } : null,
    });
    const out = await new SalesforceDestination(options(), org.fetchImpl).deliver(ctx());
    expect(out).not.toHaveProperty('code');
  });
});
