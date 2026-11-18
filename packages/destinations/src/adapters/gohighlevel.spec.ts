/**
 * Writing a submission to a HighLevel sub-account.
 *
 * A fake location sits behind `fetch`: it keeps contacts, their tags and their
 * custom fields, and behaves the way the real API did when probed (upsert
 * answers 201 with `new`, matches by email case-insensitively or by phone,
 * keeps an omitted field, clears one sent as "" or null, adds tags in lower
 * case and refuses an empty list with a 422). Each spec states what the
 * location ENDED UP with, or what it received, never how the adapter got there.
 */
import { describe, expect, it, vi } from 'vitest';
import { GOHIGHLEVEL_REASONS, type GoHighLevelDeliveryOptions } from '@quill/types';
import type { DestinationContext } from '../destination.port';
import {
  GOHIGHLEVEL_API_BASE,
  GOHIGHLEVEL_USER_AGENT,
  GoHighLevelDestination,
  GoHighLevelHttpError,
  toGoHighLevelDay,
  toGoHighLevelNumber,
  toGoHighLevelPhone,
} from './gohighlevel';

const LOCATION = 'loc-1';

const custom = (id: string, dataType: string, key = `contact.${id}`) =>
  ({ kind: 'custom', id, key, dataType }) as const;
const standard = <F extends string>(field: F) => ({ kind: 'standard', field }) as const;

const ctx = (over: Partial<DestinationContext> = {}): DestinationContext => ({
  idempotencyKey: 'submission:s1:complete:gohighlevel:0',
  submissionId: 's1',
  formId: 'f1',
  formName: 'Lead qualifier',
  accountId: 'a1',
  sessionId: 'sess1',
  score: 42,
  outcomeLabel: null,
  phase: 'complete',
  // 18 Nov 03:30 UTC = 17 Nov in Chicago.
  submittedAt: Date.UTC(2026, 10, 18, 3, 30),
  data: { email: 'sam@acme.io', firstname: 'Sam', lastname: 'Rivera', phone: '+57 318 000 0000' },
  utm: { utm_source: 'linkedin' },
  ...over,
});

const options = (over: Partial<GoHighLevelDeliveryOptions> = {}): GoHighLevelDeliveryOptions => ({
  credentials: { token: 'pit-secret', locationId: LOCATION },
  fieldMappings: {
    email: [standard('email')],
    firstname: [standard('firstName')],
    lastname: [standard('lastName')],
    phone: [standard('phone')],
  },
  ...over,
});

interface Contact {
  id: string;
  fields: Record<string, unknown>;
  customFields: Record<string, unknown>;
  tags: string[];
}

interface Recorded {
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

type Failure = { status: number; body: unknown } | 'network' | null;

/** A tiny HighLevel location. `fail` lets a spec make one call answer with an error. */
function fakeLocation(state: { contacts?: Contact[]; fail?: (req: Recorded) => Failure } = {}) {
  const contacts: Contact[] = (state.contacts ?? []).map((c) => ({ ...c, tags: [...c.tags] }));
  const requests: Recorded[] = [];
  let next = 1;
  const reply = (status: number, body: unknown) =>
    ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }) as unknown as Response;

  const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const req: Recorded = {
      path: url.pathname,
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body ?? '{}')),
    };
    requests.push(req);
    const failure = state.fail?.(req);
    if (failure === 'network') throw new TypeError('fetch failed');
    if (failure) return reply(failure.status, failure.body);

    if (req.path === '/contacts/upsert') {
      const { locationId: _l, customFields, email, phone, ...rest } = req.body as Record<string, unknown>;
      if (!email && !phone) {
        return reply(400, { statusCode: 400, message: 'Pass at least one of number, email query parameter' });
      }
      const byEmail = email
        ? contacts.find((c) => String(c.fields.email ?? '').toLowerCase() === String(email).toLowerCase())
        : undefined;
      const byPhone = phone ? contacts.find((c) => c.fields.phone === phone) : undefined;
      let contact = byEmail ?? byPhone;
      const created = !contact;
      if (!contact) {
        contact = { id: `c${next++}`, fields: {}, customFields: {}, tags: [] };
        contacts.push(contact);
      }
      for (const [key, value] of Object.entries({ email, phone, ...rest })) {
        if (value === undefined) continue;
        if (value === null) delete contact.fields[key];
        else if (value !== '') contact.fields[key] = value; // "" on a standard field is ignored
      }
      for (const { id, fieldValue } of (customFields as Array<{ id: string; fieldValue: unknown }>) ?? []) {
        if (fieldValue === '' || fieldValue === null) delete contact.customFields[id];
        else contact.customFields[id] = fieldValue;
      }
      return reply(201, { new: created, contact: { id: contact.id }, traceId: 't' });
    }
    const tagsPath = /^\/contacts\/([^/]+)\/tags$/.exec(req.path);
    if (tagsPath) {
      const contact = contacts.find((c) => c.id === decodeURIComponent(tagsPath[1]!));
      if (!contact) return reply(400, { statusCode: 400, message: 'Contact not found for id' });
      const tags = req.body.tags as string[];
      if (!tags?.length) return reply(422, { statusCode: 422, message: ['tags should not be empty'] });
      for (const tag of tags.map((t) => t.toLowerCase())) if (!contact.tags.includes(tag)) contact.tags.push(tag);
      return reply(201, { tags: contact.tags, tagsAdded: tags });
    }
    return reply(404, { statusCode: 404, message: 'no route' });
  });
  return { fetchImpl, requests, contacts };
}

const upserts = (requests: Recorded[]) => requests.filter((r) => r.path === '/contacts/upsert');

describe('who the respondent already is', () => {
  it('creates a contact the location does not have, and reports it as created', async () => {
    const loc = fakeLocation();
    const out = await new GoHighLevelDestination(options(), loc.fetchImpl).deliver(ctx());

    expect(out).toMatchObject({ delivered: true, driver: 'gohighlevel', detail: 'created contact c1' });
    expect(loc.contacts).toHaveLength(1);
    expect(loc.contacts[0]!.fields).toEqual({
      email: 'sam@acme.io',
      firstName: 'Sam',
      lastName: 'Rivera',
      phone: '+573180000000',
      source: 'dForms: Lead qualifier',
    });
  });

  it('updates the contact GHL matched, without creating another', async () => {
    const loc = fakeLocation({
      contacts: [{ id: 'c9', fields: { email: 'SAM@acme.io', city: 'Bogota' }, customFields: {}, tags: [] }],
    });
    const out = await new GoHighLevelDestination(options(), loc.fetchImpl).deliver(ctx());

    expect(out).toMatchObject({ delivered: true, detail: 'updated contact c9', responseBody: 'c9' });
    expect(loc.contacts).toHaveLength(1);
    // A field the form did not write keeps its value.
    expect(loc.contacts[0]!.fields.city).toBe('Bogota');
  });

  it('sends what GHL needs and nothing it would treat as an instruction', async () => {
    const loc = fakeLocation();
    await new GoHighLevelDestination(options({ tags: ['VIP'] }), loc.fetchImpl).deliver(ctx());

    const [upsert] = upserts(loc.requests);
    expect(upsert!.headers).toMatchObject({
      authorization: 'Bearer pit-secret',
      version: 'v3',
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': GOHIGHLEVEL_USER_AGENT,
    });
    expect(upsert!.body.locationId).toBe(LOCATION);
    expect(upsert!.body).not.toHaveProperty('tags');
    expect(upsert!.body).not.toHaveProperty('dnd');
    expect(String(loc.fetchImpl.mock.calls[0]![0])).toBe(`${GOHIGHLEVEL_API_BASE}/contacts/upsert`);
  });
});

describe('empty values never clear what GHL has', () => {
  it('omits an empty, blank or missing answer from the body, so the stored value survives', async () => {
    const loc = fakeLocation({
      contacts: [
        {
          id: 'c9',
          fields: { email: 'sam@acme.io', companyName: 'Acme' },
          customFields: { notes: 'keep me', seats: 10 },
          tags: [],
        },
      ],
    });
    const dest = new GoHighLevelDestination(
      options({
        fieldMappings: {
          email: [standard('email')],
          company: [standard('companyName')],
          notes: [custom('notes', 'TEXT')],
          seats: [custom('seats', 'NUMERICAL')],
          picks: [custom('picks', 'MULTIPLE_OPTIONS')],
        },
      }),
      loc.fetchImpl,
    );
    await dest.deliver(ctx({ data: { email: 'sam@acme.io', company: '   ', notes: '', seats: null, picks: [] } }));

    const body = upserts(loc.requests)[0]!.body;
    expect(body).not.toHaveProperty('companyName');
    expect(body).not.toHaveProperty('customFields');
    expect(JSON.stringify(body)).not.toMatch(/""|null/);
    expect(loc.contacts[0]!.fields.companyName).toBe('Acme');
    expect(loc.contacts[0]!.customFields).toEqual({ notes: 'keep me', seats: 10 });
  });
});

describe('the phone number', () => {
  it('goes as E.164 when it carries its country', async () => {
    expect(toGoHighLevelPhone('+57 (318) 000-0000')).toBe('+573180000000');
    expect(toGoHighLevelPhone('0057 318 000 0000')).toBe('+573180000000');
  });

  it('goes as bare digits without a country, for GHL to read in the location country', () => {
    expect(toGoHighLevelPhone('(202) 555-0143')).toBe('2025550143');
  });

  it('is left out when it is not a phone number', async () => {
    expect(toGoHighLevelPhone('not a phone')).toBeUndefined();
    expect(toGoHighLevelPhone('12345')).toBeUndefined();
    expect(toGoHighLevelPhone('+1234567890123456')).toBeUndefined();

    const loc = fakeLocation();
    await new GoHighLevelDestination(options(), loc.fetchImpl).deliver(ctx({ data: { email: 'a@b.co', phone: 'n/a' } }));
    expect(upserts(loc.requests)[0]!.body).not.toHaveProperty('phone');
  });

  it('delivers on the phone alone when there is no email', async () => {
    const loc = fakeLocation();
    const out = await new GoHighLevelDestination(options(), loc.fetchImpl).deliver(
      ctx({ data: { phone: '+1 202 555 0143' } }),
    );
    expect(out.delivered).toBe(true);
    expect(upserts(loc.requests)[0]!.body).toMatchObject({ phone: '+12025550143' });
    expect(upserts(loc.requests)[0]!.body).not.toHaveProperty('email');
  });
});

describe('what each custom field receives', () => {
  const mapped = {
    email: [standard('email')],
    text: [custom('qa_text', 'TEXT')],
    num: [custom('qa_number', 'NUMERICAL')],
    money: [custom('qa_money', 'MONETORY')],
    tel: [custom('qa_phone', 'PHONE')],
    single: [custom('qa_single', 'SINGLE_OPTIONS')],
    radio: [custom('qa_radio', 'RADIO')],
    multi: [custom('qa_multi', 'MULTIPLE_OPTIONS')],
    check: [custom('qa_checkbox', 'CHECKBOX')],
    day: [custom('qa_date', 'DATE')],
  };

  const sent = async (data: Record<string, unknown>, over: Partial<GoHighLevelDeliveryOptions> = {}) => {
    const loc = fakeLocation();
    await new GoHighLevelDestination(options({ fieldMappings: mapped, ...over }), loc.fetchImpl).deliver(
      ctx({ data: { email: 'sam@acme.io', ...data } }),
    );
    const list = (upserts(loc.requests)[0]!.body.customFields ?? []) as Array<{ id: string; fieldValue: unknown }>;
    return Object.fromEntries(list.map((f) => [f.id, f.fieldValue]));
  };

  it('converts each value to the shape its type takes', async () => {
    expect(
      await sent({
        text: 'Line one\nLine two',
        num: '7',
        money: '1,234.50',
        tel: '+57 318 000 0000',
        single: 'Pro',
        radio: ['Yes'],
        multi: ['Email', 'SMS, text'],
        check: 'Red',
        day: '2026-11-03',
      }),
    ).toEqual({
      qa_text: 'Line one\nLine two',
      qa_number: 7,
      qa_money: 1234.5,
      qa_phone: '+573180000000',
      qa_single: 'Pro',
      qa_radio: 'Yes',
      // A list stays a list: a comma inside one choice never splits it.
      qa_multi: ['Email', 'SMS, text'],
      qa_checkbox: ['Red'],
      qa_date: '2026-11-03',
    });
  });

  it('leaves out a number field whose answer is not a number, instead of letting GHL clear it', async () => {
    expect(await sent({ num: 'abc', money: '12abc' })).toEqual({});
    expect(toGoHighLevelNumber('0x10')).toBeUndefined();
    expect(toGoHighLevelNumber('1e3')).toBeUndefined();
    expect(toGoHighLevelNumber('')).toBeUndefined();
    expect(toGoHighLevelNumber('-3.75')).toBe(-3.75);
  });

  it('names an instant in a date field by the day in the destination zone, not the UTC day', async () => {
    expect(await sent({ day: '2026-11-18T03:00:00Z' }, { dayTimezone: 'America/Chicago' })).toEqual({
      qa_date: '2026-11-17',
    });
    expect(toGoHighLevelDay('2026-02-30')).toBeUndefined();
    expect(toGoHighLevelDay('11/18/2026')).toBeUndefined();
  });

  it('keeps the day of a date-time without an offset, and never reads a number as a date', async () => {
    expect(await sent({ day: '2026-11-18T23:30' }, { dayTimezone: 'Asia/Tokyo' })).toEqual({ qa_date: '2026-11-18' });
    expect(await sent({ day: 42 })).toEqual({});
  });

  it('sends the submitted day to the date field in the destination zone', async () => {
    const loc = fakeLocation();
    await new GoHighLevelDestination(
      options({ dateField: custom('qa_date', 'DATE'), dayTimezone: 'America/Chicago' }),
      loc.fetchImpl,
    ).deliver(ctx());
    expect(upserts(loc.requests)[0]!.body.customFields).toEqual([{ id: 'qa_date', fieldValue: '2026-11-17' }]);
  });

  it('sends the score as a number and the UTMs as text', async () => {
    const loc = fakeLocation();
    await new GoHighLevelDestination(
      options({
        scoreField: custom('qa_number', 'NUMERICAL'),
        utmMappings: { utm_source: custom('utm_source', 'TEXT') },
      }),
      loc.fetchImpl,
    ).deliver(ctx());
    expect(upserts(loc.requests)[0]!.body.customFields).toEqual([
      { id: 'utm_source', fieldValue: 'linkedin' },
      { id: 'qa_number', fieldValue: 42 },
    ]);
  });

  it('reads the type GHL reports now over the one stored on the mapping', async () => {
    // Stored as TEXT, now a NUMERICAL field: "abc" would clear it, so it is left out.
    expect(await sent({ text: 'abc' }, { customFieldTypes: { qa_text: 'NUMERICAL' } })).toEqual({});
    // Changed to a type the upsert does not take: nothing goes.
    expect(await sent({ text: 'hello' }, { customFieldTypes: { qa_text: 'SIGNATURE' } })).toEqual({});
  });
});

describe('a field that does not suit its slot gets nothing', () => {
  it('refuses a score to a text field, a date to a number field and a UTM to an options field', async () => {
    const loc = fakeLocation();
    await new GoHighLevelDestination(
      options({
        scoreField: custom('qa_text', 'TEXT'),
        dateField: custom('qa_number', 'NUMERICAL'),
        utmMappings: { utm_source: custom('qa_multi', 'MULTIPLE_OPTIONS') },
      }),
      loc.fetchImpl,
    ).deliver(ctx());
    expect(upserts(loc.requests)[0]!.body).not.toHaveProperty('customFields');
  });

  it('refuses the slot by the CURRENT type too', async () => {
    const loc = fakeLocation();
    await new GoHighLevelDestination(
      options({ scoreField: custom('qa_number', 'NUMERICAL'), customFieldTypes: { qa_number: 'TEXT' } }),
      loc.fetchImpl,
    ).deliver(ctx());
    expect(upserts(loc.requests)[0]!.body).not.toHaveProperty('customFields');
  });
});

describe('precedence', () => {
  it('lets a fixed value fill only a field nothing else wrote', async () => {
    const loc = fakeLocation();
    await new GoHighLevelDestination(
      options({
        fieldMappings: { email: [standard('email')], plan: [custom('qa_single', 'SINGLE_OPTIONS')] },
        staticFields: [
          { target: custom('qa_single', 'SINGLE_OPTIONS'), value: 'Basic' },
          { target: standard('companyName'), value: 'From the form' },
          { target: custom('qa_text', 'TEXT'), value: 'campaign-q4' },
        ],
      }),
      loc.fetchImpl,
    ).deliver(ctx({ data: { email: 'sam@acme.io', plan: 'Pro' } }));

    const body = upserts(loc.requests)[0]!.body;
    expect(body.companyName).toBe('From the form');
    expect(body.customFields).toEqual([
      { id: 'qa_single', fieldValue: 'Pro' },
      { id: 'qa_text', fieldValue: 'campaign-q4' },
    ]);
  });

  it('never takes the email or the phone from a fixed value, which would merge every respondent', async () => {
    const loc = fakeLocation();
    await new GoHighLevelDestination(
      options({
        fieldMappings: { firstname: [standard('firstName')] },
        staticFields: [
          { target: standard('email'), value: 'sales@acme.io' },
          { target: standard('phone'), value: '+1 202 555 0143' },
        ],
      }),
      loc.fetchImpl,
    ).deliver(ctx({ data: { firstname: 'Sam', email: 'sam@acme.io' } }));
    const body = upserts(loc.requests)[0]!.body;
    expect(body.email).toBe('sam@acme.io');
    expect(body).not.toHaveProperty('phone');
  });

  it('lets an empty answer leave its field to the fixed value', async () => {
    const loc = fakeLocation();
    await new GoHighLevelDestination(
      options({
        fieldMappings: { email: [standard('email')], plan: [custom('qa_single', 'SINGLE_OPTIONS')] },
        staticFields: [{ target: custom('qa_single', 'SINGLE_OPTIONS'), value: 'Basic' }],
      }),
      loc.fetchImpl,
    ).deliver(ctx({ data: { email: 'sam@acme.io', plan: '' } }));
    expect(upserts(loc.requests)[0]!.body.customFields).toEqual([{ id: 'qa_single', fieldValue: 'Basic' }]);
  });

  it('keeps a mapped answer over a UTM aimed at the same field', async () => {
    const loc = fakeLocation();
    await new GoHighLevelDestination(
      options({
        fieldMappings: { email: [standard('email')], channel: [custom('utm_source', 'TEXT')] },
        utmMappings: { utm_source: custom('utm_source', 'TEXT') },
      }),
      loc.fetchImpl,
    ).deliver(ctx({ data: { email: 'sam@acme.io', channel: 'a friend' } }));
    expect(upserts(loc.requests)[0]!.body.customFields).toEqual([{ id: 'utm_source', fieldValue: 'a friend' }]);
  });

  it('joins both parts of a name question mapped to the full name', async () => {
    const loc = fakeLocation();
    await new GoHighLevelDestination(
      options({
        fieldMappings: { email: [standard('email')], firstname: [standard('name')], lastname: [standard('name')] },
      }),
      loc.fetchImpl,
    ).deliver(ctx());
    expect(upserts(loc.requests)[0]!.body.name).toBe('Sam Rivera');
  });

  it('uses the source the author set, else the form name', async () => {
    const loc = fakeLocation();
    await new GoHighLevelDestination(options({ source: '  Webinar  ' }), loc.fetchImpl).deliver(ctx());
    await new GoHighLevelDestination(options({ source: '   ' }), loc.fetchImpl).deliver(ctx());
    expect(upserts(loc.requests).map((r) => r.body.source)).toEqual(['Webinar', 'dForms: Lead qualifier']);
  });
});

describe('tags', () => {
  it('adds them after the upsert, keeping the ones the contact had', async () => {
    const loc = fakeLocation({
      contacts: [{ id: 'c9', fields: { email: 'sam@acme.io' }, customFields: {}, tags: ['existing'] }],
    });
    await new GoHighLevelDestination(options({ tags: ['VIP', ' webinar ', 'vip', ''] }), loc.fetchImpl).deliver(ctx());

    expect(loc.requests.map((r) => r.path)).toEqual(['/contacts/upsert', '/contacts/c9/tags']);
    expect(loc.requests[1]!.body).toEqual({ tags: ['VIP', 'webinar'] });
    expect(loc.contacts[0]!.tags).toEqual(['existing', 'vip', 'webinar']);
  });

  it('makes no tags call when there are none to add', async () => {
    const loc = fakeLocation();
    await new GoHighLevelDestination(options({ tags: ['  '] }), loc.fetchImpl).deliver(ctx());
    expect(loc.requests.map((r) => r.path)).toEqual(['/contacts/upsert']);
  });
});

describe('nothing to match the respondent by', () => {
  it('skips without a request when there is neither an email nor a phone', async () => {
    const loc = fakeLocation();
    const out = await new GoHighLevelDestination(options(), loc.fetchImpl).deliver(
      ctx({ data: { email: 'not-an-email', firstname: 'Sam', phone: 'none' } }),
    );
    expect(out).toEqual({ delivered: false, driver: 'gohighlevel', detail: GOHIGHLEVEL_REASONS.noEmailOrPhone });
    expect(loc.fetchImpl).not.toHaveBeenCalled();
  });
});

describe('which failures retry', () => {
  const failing = (status: number, body: unknown, where = '/contacts/upsert') =>
    fakeLocation({ fail: (req) => (req.path.startsWith(where) || req.path.endsWith(where) ? { status, body } : null) });

  it.each([
    [401, { statusCode: 401, message: 'Invalid Private Integration token' }, GOHIGHLEVEL_REASONS.tokenRejected],
    [401, { statusCode: 401, message: 'The token is not authorized for this scope.' }, GOHIGHLEVEL_REASONS.tokenRejected],
    [
      403,
      { statusCode: 403, message: 'The token does not have access to this location.' },
      GOHIGHLEVEL_REASONS.locationForbidden,
    ],
  ])('skips a %i with the reconnect reason and marks the connection', async (status, body, reason) => {
    const loc = failing(status, body);
    const onRejected = vi.fn();
    const out = await new GoHighLevelDestination(options({ onRejected }), loc.fetchImpl).deliver(ctx());
    expect(out).toMatchObject({ delivered: false, driver: 'gohighlevel', detail: reason, responseStatus: status });
    expect(onRejected).toHaveBeenCalledWith(status);
  });

  it('still skips when marking the connection fails', async () => {
    const loc = failing(401, { statusCode: 401, message: 'Invalid Private Integration token' });
    const onRejected = vi.fn(async () => {
      throw new Error('db down');
    });
    const out = await new GoHighLevelDestination(options({ onRejected }), loc.fetchImpl).deliver(ctx());
    expect(out).toMatchObject({ delivered: false, detail: GOHIGHLEVEL_REASONS.tokenRejected });
  });

  it('throws a Cloudflare 1010 refusal and never marks the connection', async () => {
    const loc = failing(403, { error_code: 1010, cloudflare_error: true, title: 'Access denied' });
    const onRejected = vi.fn();
    await expect(new GoHighLevelDestination(options({ onRejected }), loc.fetchImpl).deliver(ctx())).rejects.toBeInstanceOf(
      GoHighLevelHttpError,
    );
    expect(onRejected).not.toHaveBeenCalled();
  });

  it('throws a 403 whose body is not JSON, an edge page rather than GHL', async () => {
    const onRejected = vi.fn();
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => '<html>Access denied</html>',
    })) as unknown as typeof fetch;
    await expect(new GoHighLevelDestination(options({ onRejected }), fetchImpl).deliver(ctx())).rejects.toMatchObject({
      status: 403,
    });
    expect(onRejected).not.toHaveBeenCalled();
  });

  it('throws a success that names no contact, since asking again is safe', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ new: true, traceId: 't' }),
    })) as unknown as typeof fetch;
    await expect(new GoHighLevelDestination(options(), fetchImpl).deliver(ctx())).rejects.toBeInstanceOf(
      GoHighLevelHttpError,
    );
  });

  it('skips a refused tags call with the reconnect reason and the request it refused', async () => {
    const loc = failing(401, { statusCode: 401, message: 'The token is not authorized for this scope.' }, '/tags');
    const onRejected = vi.fn();
    const out = await new GoHighLevelDestination(options({ tags: ['vip'], onRejected }), loc.fetchImpl).deliver(ctx());
    expect(out).toMatchObject({
      delivered: false,
      detail: GOHIGHLEVEL_REASONS.tokenRejected,
      requestBody: JSON.stringify({ tags: ['vip'] }),
    });
    expect(onRejected).toHaveBeenCalledWith(401);
  });

  it('skips a 400 with GHL message, and a 422 with its list of messages joined', async () => {
    const bad = failing(400, { statusCode: 400, message: 'The string supplied did not seem to be a phone number' });
    await expect(new GoHighLevelDestination(options(), bad.fetchImpl).deliver(ctx())).resolves.toMatchObject({
      delivered: false,
      detail: 'HTTP 400: The string supplied did not seem to be a phone number',
    });
    const invalid = failing(422, { statusCode: 422, message: ['email must be an email', 'phone is bad'] });
    await expect(new GoHighLevelDestination(options(), invalid.fetchImpl).deliver(ctx())).resolves.toMatchObject({
      delivered: false,
      detail: 'HTTP 422: email must be an email; phone is bad',
      responseStatus: 422,
    });
  });

  it.each([429, 500, 502, 503])('throws a %i so the outbox retries', async (status) => {
    const loc = failing(status, { statusCode: status, message: 'busy' });
    const onRejected = vi.fn();
    await expect(new GoHighLevelDestination(options({ onRejected }), loc.fetchImpl).deliver(ctx())).rejects.toMatchObject({
      status,
    });
    expect(onRejected).not.toHaveBeenCalled();
  });

  it('throws a network failure', async () => {
    const loc = fakeLocation({ fail: () => 'network' });
    await expect(new GoHighLevelDestination(options(), loc.fetchImpl).deliver(ctx())).rejects.toBeInstanceOf(
      GoHighLevelHttpError,
    );
  });

  it('throws when the contact vanished before its tags, so the retry upserts it again', async () => {
    const loc = failing(400, { statusCode: 400, message: 'Contact not found for id' }, '/tags');
    await expect(
      new GoHighLevelDestination(options({ tags: ['vip'] }), loc.fetchImpl).deliver(ctx()),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('a retry duplicates nothing', () => {
  it('lands on the same contact with the same tags when the tags step failed the first time', async () => {
    let tagCalls = 0;
    const loc = fakeLocation({
      fail: (req) => (req.path.endsWith('/tags') && ++tagCalls === 1 ? { status: 503, body: { message: 'down' } } : null),
    });
    const dest = new GoHighLevelDestination(options({ tags: ['vip'] }), loc.fetchImpl);

    await expect(dest.deliver(ctx())).rejects.toMatchObject({ status: 503 });
    const out = await dest.deliver(ctx());
    await dest.deliver(ctx());

    expect(out).toMatchObject({ delivered: true, detail: 'updated contact c1' });
    expect(loc.contacts).toHaveLength(1);
    expect(loc.contacts[0]!.tags).toEqual(['vip']);
  });
});
