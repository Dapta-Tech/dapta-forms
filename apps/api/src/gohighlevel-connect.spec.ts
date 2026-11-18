/**
 * HighLevel, through the real controllers, the real delivery path and an
 * in-memory database, with a stateful fake HighLevel behind `fetch` that
 * answers the way the sandbox did (spec #160, "Hallazgos del sandbox").
 *
 * Locks the parts a customer would notice:
 *   1. connect proves the token against the location, one call per scope,
 *      stores token and Location ID encrypted, and shows the sub-account's
 *      name, the Location ID and the token's last 4;
 *   2. each refusal comes back as the reason the card explains, and a token
 *      of the wrong shape or a Location ID with nothing to read is refused
 *      before any request;
 *   3. replacing the token keeps every form's mapping and clears a rejection;
 *      disconnecting removes the connection and the cached fields;
 *   4. the field list reads the CONNECTED location, caches per account,
 *      offers only mappable types, and never fails the request;
 *   5. a save refuses a custom field whose type cannot take what is mapped;
 *   6. a delivery is handed the stored connection, the live field types and
 *      a rejection callback that marks the connection.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  createDb,
  decryptToken,
  listOutbox,
  getAccountByCode,
  getFormById,
  getIntegration,
  inviteMember,
  listForms,
  listIntegrationStatuses,
  migrate,
  seed,
  updateFormDestinations,
  type Db,
} from '@quill/db';
import type { ServerEnv } from '@quill/config/env';
import type { DestinationSpec } from '@quill/destinations';
import { GOHIGHLEVEL_REASONS, goHighLevelDestinationSchema, type GoHighLevelDeliveryOptions } from '@quill/types';
import { SubmissionNotifier, LogOnlyEmailProvider } from '@quill/notifications';
import {
  CalendlyEventTypesService,
  FormDestinationsController,
  HubspotPropertiesService,
  IntegrationsController,
} from './integrations.controller';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';
import { extractGoHighLevelLocationId } from './gohighlevel-api';
import { GoHighLevelFieldsService } from './gohighlevel-fields';
import { DestinationEffects } from './destination-effects';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { SubmissionService } from './submission.service';
import { EmailEffects } from './email-effects';
import { AnalyticsService } from './analytics.service';
import { OutboxWorker } from './outbox.worker';

const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
const BASE = 'https://services.leadconnectorhq.com';
const LOC = 'Loc0Acme0000000000a1';
const OTHER_LOC = 'Loc0Other000000000b2';
// Low-entropy stand-ins on purpose: a realistic-looking value here is what a
// secret scanner flags in a public repo, and these never meet a real GHL.
const TOKEN = 'pit-aaaa-bbbb-cccc-1234';
const TOKEN_TWO = 'pit-zzzz-yyyy-xxxx-5678';
const OTHER_TOKEN = 'pit-oooo-oooo-oooo-0000';

const asOwner = (): ReqLike => ({ headers: {} });
const asEmail = (email: string): ReqLike => ({ headers: { 'x-quill-email': email } });

type Scope = 'locations' | 'customFields' | 'contacts';
const ALL_SCOPES: Scope[] = ['locations', 'customFields', 'contacts'];

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

interface FakeField {
  id: string;
  name: string;
  fieldKey: string;
  dataType: string;
  model?: string;
  picklistOptions?: string[];
}

const SANDBOX_FIELDS: FakeField[] = [
  { id: 'f-text', name: 'QA text', fieldKey: 'contact.qa_text', dataType: 'TEXT' },
  { id: 'f-num', name: 'QA number', fieldKey: 'contact.qa_number', dataType: 'NUMERICAL' },
  { id: 'f-date', name: 'QA date', fieldKey: 'contact.qa_date', dataType: 'DATE' },
  {
    id: 'f-check',
    name: 'QA checkbox',
    fieldKey: 'contact.qa_checkbox',
    dataType: 'CHECKBOX',
    picklistOptions: ['Red', 'Green', 'Blue'],
  },
  { id: 'f-single', name: 'Plan', fieldKey: 'contact.qa_single', dataType: 'SINGLE_OPTIONS', picklistOptions: ['Basic', 'Pro'] },
  { id: 'f-utm', name: 'utm_source', fieldKey: 'contact.utm_source', dataType: 'TEXT' },
  // Not offered: the upsert does not take these, or how it does is unconfirmed.
  { id: 'f-list', name: 'A list', fieldKey: 'contact.a_list', dataType: 'TEXTBOX_LIST' },
  { id: 'f-file', name: 'A file', fieldKey: 'contact.a_file', dataType: 'FILE_UPLOAD' },
  { id: 'f-sign', name: 'A signature', fieldKey: 'contact.a_sign', dataType: 'SIGNATURE' },
  { id: 'f-float', name: 'A float', fieldKey: 'contact.a_float', dataType: 'FLOAT' },
  { id: 'f-time', name: 'A time', fieldKey: 'contact.a_time', dataType: 'TIME' },
  { id: 'f-new', name: 'A type GHL adds later', fieldKey: 'contact.a_new', dataType: 'HOLOGRAM' },
  { id: 'f-opp', name: 'An opportunity field', fieldKey: 'opportunity.x', dataType: 'TEXT', model: 'opportunity' },
];

/**
 * A fake HighLevel: tokens with the location and scopes they were created
 * for, the location's custom fields, and its contacts. `mode` makes every
 * request fail the way a GHL outage, a Cloudflare block or a dropped
 * connection does.
 */
function fakeGhl() {
  const calls: Call[] = [];
  const tokens = new Map<string, { locationId: string; scopes: Set<Scope> }>([
    [TOKEN, { locationId: LOC, scopes: new Set(ALL_SCOPES) }],
    [TOKEN_TWO, { locationId: LOC, scopes: new Set(ALL_SCOPES) }],
    [OTHER_TOKEN, { locationId: OTHER_LOC, scopes: new Set(ALL_SCOPES) }],
  ]);
  const names: Record<string, string> = { [LOC]: 'Acme Corp (dForms QA)', [OTHER_LOC]: 'Other Agency Client' };
  const fields: Record<string, FakeField[]> = { [LOC]: [...SANDBOX_FIELDS], [OTHER_LOC]: [{ id: 'o-1', name: 'Other', fieldKey: 'contact.other', dataType: 'TEXT' }] };
  const contacts: Array<{
    id: string;
    locationId: string;
    email?: string;
    fields: Record<string, unknown>;
    customFields: Record<string, unknown>;
    tags: Set<string>;
  }> = [];
  const state = {
    mode: null as null | 'down' | 'cloudflare' | 'network',
    fieldsDown: false,
    /** What the next upserts answer instead of working, one per call. */
    upsertFails: [] as Array<{ status: number; message: string | string[] }>,
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const scopeRefusal = () => json({ statusCode: 401, message: 'The token is not authorized for this scope.' }, 401);
  const noAccess = () => json({ statusCode: 403, message: 'The token does not have access to this location.' }, 403);

  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ method, path: url.pathname + url.search, headers, body });
    if (state.mode === 'network') {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    }
    if (state.mode === 'down') return json({ statusCode: 503, message: 'Service Unavailable' }, 503);
    // Cloudflare in front of GHL blocks the default agents of HTTP clients.
    if (state.mode === 'cloudflare' || !headers['user-agent'] || /node|undici|python/i.test(headers['user-agent'])) {
      return json({ error_code: 1010, cloudflare_error: true, error_name: 'browser_signature_banned' }, 403);
    }
    if (url.origin !== BASE) return json({ message: 'wrong host' }, 404);
    if (!headers.version) return json({ statusCode: 401, message: 'version header was not found.' }, 401);
    const bearer = /^Bearer (.+)$/.exec(headers.authorization ?? '')?.[1] ?? '';
    const grant = tokens.get(bearer);
    if (!grant) {
      return json(
        { statusCode: 401, message: bearer.startsWith('pit-') ? 'Invalid Private Integration token' : 'Invalid JWT' },
        401,
      );
    }
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] === 'locations' && segments.length === 2 && method === 'GET') {
      if (!grant.scopes.has('locations')) return scopeRefusal();
      if (segments[1] !== grant.locationId) return json({ statusCode: 403, message: 'Forbidden resource', error: 'Forbidden' }, 403);
      return json({ location: { id: segments[1], name: names[segments[1]!], timezone: 'America/Chicago' }, traceId: 't' });
    }
    if (segments[0] === 'locations' && segments[2] === 'customFields' && method === 'GET') {
      if (!grant.scopes.has('customFields')) return scopeRefusal();
      if (segments[1] !== grant.locationId) return noAccess();
      if (state.fieldsDown) return json({ statusCode: 502, message: 'Bad Gateway' }, 502);
      // Like GHL, unsorted; the opportunity field stands for an item of another model.
      return json({ customFields: (fields[segments[1]!] ?? []).map((f) => ({ model: 'contact', position: 0, ...f })) });
    }
    if (url.pathname === '/contacts/upsert' && method === 'POST') {
      if (!grant.scopes.has('contacts')) return scopeRefusal();
      const payload = JSON.parse(body ?? '{}') as {
        locationId?: string;
        email?: string;
        phone?: string;
        customFields?: Array<{ id: string; fieldValue: unknown }>;
        [k: string]: unknown;
      };
      if (payload.locationId !== grant.locationId) return noAccess();
      const failure = state.upsertFails.shift();
      if (failure) return json({ statusCode: failure.status, message: failure.message }, failure.status);
      if (!payload.email && !payload.phone) {
        return json({ statusCode: 400, message: 'Pass at least one of number, email query parameter' }, 400);
      }
      if (payload.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.email)) {
        return json({ statusCode: 422, message: ['email must be an email'], error: 'Unprocessable Entity' }, 422);
      }
      const { locationId: _l, customFields, ...standard } = payload;
      const email = payload.email?.toLowerCase();
      let contact = contacts.find((c) => c.locationId === payload.locationId && c.email === email);
      const created = !contact;
      if (!contact) {
        contact = { id: `c-${contacts.length + 1}`, locationId: payload.locationId!, email, fields: {}, customFields: {}, tags: new Set() };
        contacts.push(contact);
      }
      Object.assign(contact.fields, standard);
      for (const f of customFields ?? []) contact.customFields[f.id] = f.fieldValue;
      return json({ new: created, contact: { id: contact.id } }, 201);
    }
    const tagged = /^\/contacts\/([^/]+)\/tags$/.exec(url.pathname);
    if (tagged && method === 'POST') {
      if (!grant.scopes.has('contacts')) return scopeRefusal();
      const contact = contacts.find((c) => c.id === tagged[1]);
      if (!contact) return json({ statusCode: 400, message: 'Contact not found for id' }, 400);
      for (const t of (JSON.parse(body ?? '{}') as { tags: string[] }).tags) contact.tags.add(t.toLowerCase());
      return json({ tags: [...contact.tags], tagsAdded: [] }, 201);
    }
    return json({ statusCode: 404, message: 'Cannot find route' }, 404);
  }) as unknown as typeof fetch;

  return { fetchImpl, calls, tokens, fields, contacts, state };
}

let db: Db;
let auth: AuthService;
let controller: IntegrationsController;
let fields: GoHighLevelFieldsService;
let ghl: ReturnType<typeof fakeGhl>;

function env(overrides: Partial<ServerEnv> = {}): ServerEnv {
  return { NODE_ENV: 'test', FORMS_ENCRYPTION_KEY: ENCRYPTION_KEY, ...overrides } as unknown as ServerEnv;
}

function build(e: ServerEnv = env()): void {
  const provider = new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });
  auth = new AuthService(db, provider);
  fields = new GoHighLevelFieldsService(db, e);
  fields.fetchImpl = ghl.fetchImpl;
  controller = new IntegrationsController(
    auth,
    new HubspotPropertiesService(e, db, ghl.fetchImpl),
    new CalendlyEventTypesService(e, db, ghl.fetchImpl),
    db,
    e,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fields,
  );
  controller.fetchImpl = ghl.fetchImpl;
}

async function accountId(): Promise<string> {
  return (await getAccountByCode(db, 'acme'))!.id;
}

/** The 400 body of a refused call. */
async function refusalOf(work: Promise<unknown>): Promise<Record<string, unknown>> {
  const err = await work.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BadRequestException);
  return (err as BadRequestException).getResponse() as Record<string, unknown>;
}

const connect = (token = TOKEN, locationId = LOC) => controller.connectGoHighLevel(asOwner(), { token, locationId });

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
  ghl = fakeGhl();
  build();
});

afterEach(async () => {
  await db.close();
});

describe('POST /v1/integrations/gohighlevel/connect', () => {
  it('proves all three scopes, stores token and location encrypted, and shows the sub-account', async () => {
    const status = await connect();

    expect(status).toEqual({
      provider: 'gohighlevel',
      connected: true,
      label: 'Acme Corp (dForms QA)',
      last4: '1234',
      connectedAt: expect.any(Number),
      locationId: LOC,
      rejectedAt: null,
    });
    expect(JSON.stringify(status)).not.toContain(TOKEN);
    // One call per scope, with the headers GHL and Cloudflare require.
    expect(ghl.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `GET /locations/${LOC}`,
      `GET /locations/${LOC}/customFields?model=contact`,
      'POST /contacts/upsert',
    ]);
    for (const c of ghl.calls) {
      expect(c.headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, version: 'v3', accept: 'application/json' });
      expect(c.headers['user-agent']).toMatch(/^dForms\//);
    }
    // The write check carries nothing to create a contact from, and creates none.
    expect(JSON.parse(ghl.calls[2]!.body!)).toEqual({ locationId: LOC });
    expect(ghl.contacts).toHaveLength(0);

    const row = await getIntegration(db, await accountId(), 'gohighlevel');
    expect(row!.encryptedToken).not.toContain(TOKEN);
    expect(JSON.parse(decryptToken(row!.encryptedToken, ENCRYPTION_KEY))).toEqual({ token: TOKEN, locationId: LOC });
    // GET /v1/integrations shows the same, token-free.
    const listed = await controller.list(asOwner());
    expect(listed.providers).toContainEqual(status);
  });

  it('takes the Location ID out of a pasted sub-account URL', async () => {
    const status = await connect(TOKEN, `  https://app.gohighlevel.com/v2/location/${LOC}/dashboard?x=1 `);
    expect(status.locationId).toBe(LOC);
    expect(ghl.calls[0]!.path).toBe(`/locations/${LOC}`);
  });

  it.each([
    ['a JWT', 'eyJhbGciOiJIUzI1NiJ9.e30.sig'],
    ['an API key without the prefix', 'aaaa-bbbb-cccc-1234'],
    ['the bare prefix', 'pit-'],
    ['a token pasted with a line break inside', 'pit-aaaa-bbbb\ncccc-1234'],
  ])('refuses %s as token_format without a single request', async (_what, token) => {
    const body = await refusalOf(connect(token));
    expect(body).toEqual({ error: 'GOHIGHLEVEL_REJECTED', reason: 'token_format', message: 'gohighlevel: token_format' });
    expect(ghl.calls).toHaveLength(0);
    expect(await getIntegration(db, await accountId(), 'gohighlevel')).toBeNull();
  });

  it('refuses a Location ID that names nothing as wrong_location, without a request', async () => {
    for (const locationId of ['https://app.gohighlevel.com/v2/settings', 'not an id!', `https://x.test/location/${'a'.repeat(3)}`]) {
      expect(await refusalOf(connect(TOKEN, locationId))).toMatchObject({ reason: 'wrong_location' });
    }
    expect(ghl.calls).toHaveLength(0);
  });

  it('says invalid_token when GHL does not know the token', async () => {
    expect(await refusalOf(connect('pit-dead-dead-dead-9999'))).toMatchObject({
      error: 'GOHIGHLEVEL_REJECTED',
      reason: 'invalid_token',
    });
    expect(ghl.calls).toHaveLength(1);
    expect(await getIntegration(db, await accountId(), 'gohighlevel')).toBeNull();
  });

  it("says wrong_location for a token of another sub-account (an agency's other client)", async () => {
    expect(await refusalOf(connect(OTHER_TOKEN, LOC))).toMatchObject({ reason: 'wrong_location' });
    expect(await getIntegration(db, await accountId(), 'gohighlevel')).toBeNull();
  });

  it.each([
    ['locations', `GET /locations/${LOC}`],
    ['customFields', `GET /locations/${LOC}/customFields?model=contact`],
    ['contacts', 'POST /contacts/upsert'],
  ] as const)('says missing_scope when the token lacks %s', async (scope, refusedAt) => {
    ghl.tokens.get(TOKEN)!.scopes.delete(scope);
    expect(await refusalOf(connect())).toMatchObject({ reason: 'missing_scope' });
    expect(ghl.calls.map((c) => `${c.method} ${c.path}`)).toContain(refusedAt);
    expect(await getIntegration(db, await accountId(), 'gohighlevel')).toBeNull();
  });

  it.each([
    ['down', 'HTTP_503'],
    ['network', 'ECONNRESET'],
    ['cloudflare', 'CLOUDFLARE_1010'],
  ] as const)('says unreachable when GHL is %s, and leaves a working connection as it was', async (mode, cause) => {
    await connect();
    const before = await getIntegration(db, await accountId(), 'gohighlevel');
    ghl.state.mode = mode;
    expect(await refusalOf(connect(TOKEN_TWO))).toEqual({
      error: 'GOHIGHLEVEL_REJECTED',
      reason: 'unreachable',
      cause,
      message: 'gohighlevel: unreachable',
    });
    // Neither replaced nor marked rejected: nothing was learned about the token.
    expect(await getIntegration(db, await accountId(), 'gohighlevel')).toEqual(before);
    const [status] = await listIntegrationStatuses(db, await accountId());
    expect(status).toMatchObject({ last4: '1234', rejectedAt: null });
  });

  it('refuses before any request when the server has no encryption key', async () => {
    build(env({ FORMS_ENCRYPTION_KEY: undefined }));
    expect(await refusalOf(connect())).toMatchObject({ error: 'ENCRYPTION_UNAVAILABLE' });
    expect(ghl.calls).toHaveLength(0);
  });

  it('is refused to a plain member', async () => {
    await inviteMember(db, await accountId(), { email: 'plain@acme.test', role: 'member' });
    await expect(
      controller.connectGoHighLevel(asEmail('plain@acme.test'), { token: TOKEN, locationId: LOC }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ghl.calls).toHaveLength(0);
  });

  it('replacing the token keeps every form mapping and clears a rejection', async () => {
    const id = await accountId();
    await connect();
    const formId = (await listForms(db, id)).find((f) => f.slug === 'lead-qualifier')!.id;
    const destination = {
      type: 'gohighlevel',
      enabled: true,
      fieldMappings: { email: [{ kind: 'standard', field: 'email' }] },
      utmMappings: { utm_source: { kind: 'custom', id: 'f-utm', key: 'contact.utm_source', dataType: 'TEXT' } },
      tags: ['dforms'],
    };
    await updateFormDestinations(db, id, formId, [destination]);
    const before = ((await getFormById(db, id, formId))!.config as { destinations: unknown[] }).destinations;
    // A delivery saw the old token refused.
    const spec = await specFor(destination);
    await spec.gohighlevel!.onRejected!(401);
    expect((await listIntegrationStatuses(db, id))[0]!.rejectedAt).toEqual(expect.any(Number));

    const status = await connect(TOKEN_TWO);

    expect(status).toMatchObject({ last4: '5678', rejectedAt: null, locationId: LOC });
    expect(await listIntegrationStatuses(db, id)).toHaveLength(1);
    expect(((await getFormById(db, id, formId))!.config as { destinations: unknown[] }).destinations).toEqual(before);
    const row = await getIntegration(db, id, 'gohighlevel');
    expect(JSON.parse(decryptToken(row!.encryptedToken, ENCRYPTION_KEY)).token).toBe(TOKEN_TWO);
  });
});

describe('DELETE /v1/integrations/gohighlevel', () => {
  it('removes the connection and the cached fields, and is idempotent', async () => {
    await connect();
    await controller.goHighLevelFieldList(asOwner());
    await controller.disconnect(asOwner(), 'gohighlevel');

    expect(await getIntegration(db, await accountId(), 'gohighlevel')).toBeNull();
    await expect(controller.goHighLevelFieldList(asOwner())).resolves.toEqual({ enabled: false, reason: 'not_connected' });
    await expect(controller.disconnect(asOwner(), 'gohighlevel')).resolves.toBeUndefined();
    // A delivery after the disconnect has nothing to write with.
    const spec = await specFor({ type: 'gohighlevel', enabled: true, fieldMappings: {}, utmMappings: {} });
    expect(spec.gohighlevel!.credentials).toEqual({ token: '', locationId: '' });
  });

  it('is refused to a plain member', async () => {
    await connect();
    await inviteMember(db, await accountId(), { email: 'plain@acme.test', role: 'member' });
    await expect(controller.disconnect(asEmail('plain@acme.test'), 'gohighlevel')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(await getIntegration(db, await accountId(), 'gohighlevel')).not.toBeNull();
  });
});

describe('GET /v1/integrations/gohighlevel/fields', () => {
  const fieldReads = () => ghl.calls.filter((c) => c.path.includes('/customFields')).length;

  it('reports not_connected before a connection exists, without a request', async () => {
    await expect(controller.goHighLevelFieldList(asOwner())).resolves.toEqual({ enabled: false, reason: 'not_connected' });
    expect(ghl.calls).toHaveLength(0);
  });

  it('lists the standard catalog and the mappable contact custom fields, sorted by name', async () => {
    await connect();
    const out = await controller.goHighLevelFieldList(asOwner());
    if (!out.enabled) throw new Error('expected fields');
    expect(out.cached).toBe(false);
    expect(out.warning).toBeUndefined();
    expect(out.standard.map((f) => f.key)).toEqual([
      'firstName',
      'lastName',
      'name',
      'email',
      'phone',
      'companyName',
      'website',
      'address1',
      'city',
      'state',
      'postalCode',
      'country',
      'dateOfBirth',
    ]);
    expect(out.standard[3]).toEqual({ kind: 'standard', key: 'email', name: 'Email', sources: ['email', 'text'] });
    // TEXTBOX_LIST, FILE_UPLOAD, SIGNATURE, FLOAT, TIME and unknown types are left out.
    expect(out.custom.map((f) => f.id)).toEqual(['f-single', 'f-check', 'f-date', 'f-num', 'f-text', 'f-utm']);
    expect(out.custom.find((f) => f.id === 'f-check')).toEqual({
      kind: 'custom',
      id: 'f-check',
      key: 'contact.qa_checkbox',
      name: 'QA checkbox',
      dataType: 'CHECKBOX',
      options: ['Red', 'Green', 'Blue'],
    });
    expect(out.custom.find((f) => f.id === 'f-text')).not.toHaveProperty('options');
  });

  it('serves the cache until refresh=1, per account', async () => {
    await connect();
    await controller.goHighLevelFieldList(asOwner());
    const after = fieldReads();
    await expect(controller.goHighLevelFieldList(asOwner())).resolves.toMatchObject({ cached: true });
    expect(fieldReads()).toBe(after);

    ghl.fields[LOC]!.push({ id: 'f-fresh', name: 'Just created', fieldKey: 'contact.fresh', dataType: 'TEXT' });
    const refreshed = await controller.goHighLevelFieldList(asOwner(), '1');
    expect(refreshed).toMatchObject({ cached: false });
    expect(fieldReads()).toBe(after + 1);
    if (!refreshed.enabled) throw new Error('expected fields');
    expect(refreshed.custom.map((f) => f.id)).toContain('f-fresh');
  });

  it('reconnecting to another sub-account never serves the previous one\'s fields', async () => {
    await connect();
    await controller.goHighLevelFieldList(asOwner());
    await connect(OTHER_TOKEN, OTHER_LOC);
    const out = await controller.goHighLevelFieldList(asOwner());
    if (!out.enabled) throw new Error('expected fields');
    expect(out.custom.map((f) => f.id)).toEqual(['o-1']);
  });

  it('still lists the standard fields, with a warning, when the custom fields cannot be read, and does not cache that', async () => {
    await connect();
    ghl.state.fieldsDown = true;
    const out = await controller.goHighLevelFieldList(asOwner());
    expect(out).toMatchObject({ enabled: true, cached: false, custom: [], warning: 'custom_fields_unavailable' });
    if (!out.enabled) throw new Error('expected fields');
    expect(out.standard).toHaveLength(13);

    ghl.state.fieldsDown = false;
    const back = await controller.goHighLevelFieldList(asOwner());
    expect(back).toMatchObject({ enabled: true, cached: false });
    expect(back).not.toHaveProperty('warning');

    ghl.state.mode = 'network';
    await expect(controller.goHighLevelFieldList(asOwner(), '1')).resolves.toMatchObject({
      warning: 'custom_fields_unavailable',
    });
  });

  it('says rejected when GHL stopped accepting the token', async () => {
    await connect();
    ghl.tokens.delete(TOKEN);
    await expect(controller.goHighLevelFieldList(asOwner(), '1')).resolves.toEqual({ enabled: false, reason: 'rejected' });
  });
});

/** The delivery spec the effects hand the destination factory for one stored entry. */
async function specFor(destination: Record<string, unknown>): Promise<DestinationSpec> {
  const effects = new DestinationEffects(db, env(), undefined, undefined, undefined, undefined, fields);
  effects.fetchImpl = ghl.fetchImpl;
  return effects['toSpec'](goHighLevelDestinationSchema.parse(destination), await accountId());
}

describe('what a delivery is handed', () => {
  const destination = {
    type: 'gohighlevel',
    enabled: true,
    fieldMappings: {
      email: [{ kind: 'standard', field: 'email' }],
      seats: [{ kind: 'custom', id: 'f-num', key: 'contact.qa_number', dataType: 'NUMERICAL' }],
    },
    utmMappings: { utm_source: { kind: 'custom', id: 'f-utm', key: 'contact.utm_source', dataType: 'TEXT' } },
    scoreField: { kind: 'custom', id: 'f-num', key: 'contact.qa_number', dataType: 'NUMERICAL' },
    dateField: { kind: 'custom', id: 'f-date', key: 'contact.qa_date', dataType: 'DATE' },
    dayTimezone: 'America/Chicago',
    staticFields: [{ target: { kind: 'standard', field: 'country' }, value: 'US' }],
    tags: ['dforms', 'webinar'],
    source: 'Spring webinar',
  };

  it('the stored connection, the mappings and the live custom-field types', async () => {
    await connect();
    const spec = await specFor(destination);
    const options = spec.gohighlevel as GoHighLevelDeliveryOptions;
    expect(spec.type).toBe('gohighlevel');
    expect(options).toMatchObject({
      credentials: { token: TOKEN, locationId: LOC },
      fieldMappings: destination.fieldMappings,
      utmMappings: destination.utmMappings,
      scoreField: destination.scoreField,
      dateField: destination.dateField,
      dayTimezone: 'America/Chicago',
      staticFields: destination.staticFields,
      tags: ['dforms', 'webinar'],
      source: 'Spring webinar',
    });
    // Every reported type, mappable or not, so a retyped field is left out.
    expect(options.customFieldTypes).toMatchObject({ 'f-num': 'NUMERICAL', 'f-date': 'DATE', 'f-file': 'FILE_UPLOAD' });
    expect(typeof options.onRejected).toBe('function');
  });

  it('no types when GHL cannot list them (the adapter falls back to the stored ones), and no re-read for a minute', async () => {
    await connect();
    ghl.state.fieldsDown = true;
    const reads = () => ghl.calls.filter((c) => c.path.includes('/customFields')).length;
    const before = reads();
    const spec = await specFor(destination);
    expect(spec.gohighlevel!.customFieldTypes).toBeUndefined();
    expect(spec.gohighlevel!.credentials.token).toBe(TOKEN);
    expect(reads()).toBe(before + 1);
    // The next delivery does not wait on the same failing call...
    ghl.state.fieldsDown = false;
    await specFor(destination);
    expect(reads()).toBe(before + 1);
    // ...while the mapping UI still reads, and a success resumes the types.
    await expect(controller.goHighLevelFieldList(asOwner())).resolves.toMatchObject({ cached: false });
    expect((await specFor(destination)).gohighlevel!.customFieldTypes).toMatchObject({ 'f-num': 'NUMERICAL' });
  });

  it('empty credentials and no callback when the workspace never connected HighLevel', async () => {
    const spec = await specFor(destination);
    expect(spec.gohighlevel!.credentials).toEqual({ token: '', locationId: '' });
    expect(spec.gohighlevel!.onRejected).toBeUndefined();
    expect(ghl.calls).toHaveLength(0);
  });

  it('onRejected marks the connection, so the card says GHL stopped accepting the token', async () => {
    await connect();
    const spec = await specFor(destination);
    await spec.gohighlevel!.onRejected!(403);
    const [status] = (await controller.list(asOwner())).providers.filter((p) => p.provider === 'gohighlevel');
    expect(status!.rejectedAt).toEqual(expect.any(Number));
  });

  it('a refusal of the token a delivery read before a reconnect does not mark the new one', async () => {
    await connect();
    const stale = await specFor(destination);
    await connect(TOKEN_TWO);
    await stale.gohighlevel!.onRejected!(401);
    expect((await listIntegrationStatuses(db, await accountId()))[0]!.rejectedAt).toBeNull();
  });

  it('degrades to the named skip, with no request, when not connected', async () => {
    const effects = new DestinationEffects(db, env(), undefined, undefined, undefined, undefined, fields);
    effects.fetchImpl = ghl.fetchImpl;
    const ctx = {
      idempotencyKey: 'submission:s1:complete:gohighlevel:0',
      submissionId: 's1',
      formId: 'f1',
      formName: 'Demo',
      accountId: await accountId(),
      sessionId: 'sess',
      score: 3,
      outcomeLabel: null,
      phase: 'complete',
      submittedAt: Date.UTC(2026, 10, 16),
      data: { email: 'sam@acme.io' },
      utm: {},
    };
    await expect(effects.deliver('complete', JSON.stringify({ destination, ctx }))).rejects.toThrow(
      GOHIGHLEVEL_REASONS.notConnected,
    );
    expect(ghl.calls).toHaveLength(0);
  });
});

describe('saving a HighLevel destination', () => {
  const custom = (id: string, dataType: string) => ({ kind: 'custom', id, key: `contact.${id}`, dataType });
  const entry = (over: Record<string, unknown> = {}) => ({
    type: 'gohighlevel',
    enabled: true,
    fieldMappings: { email: [{ kind: 'standard', field: 'email' }] },
    utmMappings: {},
    ...over,
  });
  let formId: string;
  const destinationsController = () => new FormDestinationsController(db, auth, env());
  const stored = async () =>
    ((await getFormById(db, await accountId(), formId))!.config as { destinations?: unknown[] }).destinations ?? [];

  beforeEach(async () => {
    formId = (await listForms(db, await accountId())).find((f) => f.slug === 'lead-qualifier')!.id;
  });

  it.each([
    ['the score to a text field', { scoreField: custom('qa_text', 'TEXT') }, 'scoreField', 'The score goes to a number custom field (NUMERICAL).'],
    ['the date to a number field', { dateField: custom('qa_number', 'NUMERICAL') }, 'dateField', 'The submitted date goes to a date custom field (DATE).'],
    ['a UTM to a number field', { utmMappings: { utm_source: custom('qa_number', 'NUMERICAL') } }, 'utmMappings.utm_source', 'A UTM goes to a text custom field (TEXT or LARGE_TEXT).'],
    ['an answer to a file field', { fieldMappings: { email: [{ kind: 'standard', field: 'email' }, custom('a_file', 'FILE_UPLOAD')] } }, 'fieldMappings.email.1', 'HighLevel does not take a value'],
    ['a fixed value to a signature field', { staticFields: [{ target: custom('a_sign', 'SIGNATURE'), value: 'x' }] }, 'staticFields.0.target', 'HighLevel does not take a value'],
  ])('refuses %s, says why, and stores nothing', async (_what, over, path, why) => {
    const before = await stored();
    const body = await refusalOf(destinationsController().putDestinations(asOwner(), formId, { destinations: [entry(over)] }));
    expect(body).toMatchObject({ error: 'BAD_REQUEST', path: `destinations.0.${path}` });
    expect(body.message).toContain('Destination 1 (HighLevel) maps');
    expect(body.message).toContain(why);
    expect(await stored()).toEqual(before);
  });

  it('saves a mapping whose every target takes what it is given', async () => {
    const ok = entry({
      fieldMappings: { email: [{ kind: 'standard', field: 'email' }, custom('qa_text', 'LARGE_TEXT')] },
      utmMappings: { utm_source: custom('utm_source', 'TEXT') },
      scoreField: custom('qa_number', 'NUMERICAL'),
      dateField: custom('qa_date', 'DATE'),
      staticFields: [{ target: custom('qa_multi', 'MULTIPLE_OPTIONS'), value: 'Email' }],
    });
    const out = await destinationsController().putDestinations(asOwner(), formId, { destinations: [ok] });
    expect(out).toBeTruthy();
    expect(await stored()).toHaveLength(1);
  });

  it.each(['email', 'phone'])('refuses a fixed value on the %s field, which would merge every respondent', async (field) => {
    const body = await refusalOf(
      destinationsController().putDestinations(asOwner(), formId, {
        destinations: [entry({ staticFields: [{ target: { kind: 'standard', field }, value: 'x@acme.io' }] })],
      }),
    );
    expect(body).toMatchObject({ error: 'BAD_REQUEST', path: 'destinations.0.staticFields.0.target' });
    expect(body.message).toContain(`gives the ${field} field a fixed value`);
    // Another standard field takes one.
    await expect(
      destinationsController().putDestinations(asOwner(), formId, {
        destinations: [entry({ staticFields: [{ target: { kind: 'standard', field: 'country' }, value: 'US' }] })],
      }),
    ).resolves.toBeTruthy();
  });

  it('keeps a fixed email the form already stores, even after another fixed value is removed', async () => {
    const staticFields = [
      { target: { kind: 'standard', field: 'country' }, value: 'US' },
      { target: { kind: 'standard', field: 'email' }, value: 'x@acme.io' },
    ];
    await updateFormDestinations(db, await accountId(), formId, [entry({ staticFields })]);
    await expect(
      destinationsController().putDestinations(asOwner(), formId, {
        destinations: [entry({ staticFields: [staticFields[1]] })],
      }),
    ).resolves.toBeTruthy();
    // Phone is not stored, so it is new and refused.
    expect(
      await refusalOf(
        destinationsController().putDestinations(asOwner(), formId, {
          destinations: [entry({ staticFields: [{ target: { kind: 'standard', field: 'phone' }, value: '1' }] })],
        }),
      ),
    ).toMatchObject({ path: 'destinations.0.staticFields.0.target' });
  });

  it('keeps a target the form already stores, so an untouched form stays saveable', async () => {
    const legacy = entry({ scoreField: custom('qa_text', 'TEXT') });
    await updateFormDestinations(db, await accountId(), formId, [legacy]);
    const webhook = { type: 'webhook', enabled: true, settings: { url: 'https://example.com/hook' } };
    await expect(
      destinationsController().putDestinations(asOwner(), formId, { destinations: [legacy, webhook] }),
    ).resolves.toBeTruthy();
    // Moving it somewhere just as wrong is new, and refused.
    const moved = entry({ dateField: custom('qa_text', 'TEXT') });
    expect(
      await refusalOf(destinationsController().putDestinations(asOwner(), formId, { destinations: [moved] })),
    ).toMatchObject({ path: 'destinations.0.dateField' });
  });

  it('refuses the same on POST /v1/forms', async () => {
    const submissions = new SubmissionService(db, new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db));
    const creator = new AdminCrudController(db, auth, new AdminService(db), submissions, new AnalyticsService(db), undefined, undefined, undefined, undefined, env());
    const body = await refusalOf(
      creator.createForm(asOwner(), {
        name: 'GHL form',
        config: {
          version: 1,
          steps: [{ key: 'email', type: 'email', question: 'Your email?' }],
          destinations: [entry({ scoreField: custom('qa_date', 'DATE') })],
        },
      }),
    );
    expect(body).toMatchObject({ error: 'BAD_REQUEST', path: 'destinations.0.scoreField' });
  });
});

describe('extractGoHighLevelLocationId', () => {
  it.each([
    [LOC, LOC],
    [` ${LOC} `, LOC],
    [`https://app.gohighlevel.com/v2/location/${LOC}/dashboard`, LOC],
    [`https://crm.agency.test/v2/location/${LOC}`, LOC],
    [`app.gohighlevel.com/location/${LOC}/settings/company`, LOC],
  ])('reads %s', (raw, expected) => {
    expect(extractGoHighLevelLocationId(raw)).toBe(expected);
  });

  it.each(['', 'https://app.gohighlevel.com/v2/agency/dashboard', 'loc id with spaces', `${LOC}/../x`])(
    'finds nothing in %s',
    (raw) => {
      expect(extractGoHighLevelLocationId(raw)).toBeNull();
    },
  );
});

describe('delivering a submission to HighLevel, through the outbox and the real adapter', () => {
  const destination = {
    type: 'gohighlevel',
    enabled: true,
    fieldMappings: {
      email: [{ kind: 'standard', field: 'email' }],
      company: [{ kind: 'standard', field: 'companyName' }],
      // Stored as text when it was chosen; the location now says it is a number.
      seats: [{ kind: 'custom', id: 'f-num', key: 'contact.qa_number', dataType: 'TEXT' }],
      plan: [{ kind: 'custom', id: 'f-single', key: 'contact.qa_single', dataType: 'SINGLE_OPTIONS' }],
    },
    utmMappings: { utm_source: { kind: 'custom', id: 'f-utm', key: 'contact.utm_source', dataType: 'TEXT' } },
    tags: ['dForms', 'Webinar'],
  };
  let effects: DestinationEffects;
  let worker: OutboxWorker;
  let sequence = 0;

  /** Submit one response and settle its delivery the way the worker does. */
  const submit = async (data: Record<string, unknown>, config: unknown[] = [destination]) => {
    const submissionId = `sub-${++sequence}`;
    await effects.enqueueSubmissionDeliveries({
      formId: 'form-1',
      formName: 'Spring webinar',
      accountId: await accountId(),
      submissionId,
      sessionId: `sess-${submissionId}`,
      score: 7,
      outcomeLabel: null,
      phase: 'complete',
      submittedAt: Date.UTC(2026, 10, 17, 15),
      data,
      config: { version: 1, steps: [], destinations: config },
    });
    await worker.drainOnce(Date.now() + 1_000);
    return submissionId;
  };
  const row = async (submissionId: string) => (await listOutbox(db, { kind: 'gohighlevel', subjectUid: submissionId }))[0]!;
  // Deliveries only: the connect probe's own upsert (`{locationId}`) is not one.
  const upserts = () =>
    ghl.calls.filter((c) => c.path === '/contacts/upsert' && Object.keys(JSON.parse(c.body ?? '{}')).length > 1);
  const rejectedAt = async () => (await listIntegrationStatuses(db, await accountId()))[0]!.rejectedAt;
  const lead = { email: 'Sam@Acme.io', company: 'Acme', seats: '25', plan: 'Pro', utm: { utm_source: 'linkedin' } };

  beforeEach(() => {
    effects = new DestinationEffects(db, env(), undefined, undefined, undefined, undefined, fields);
    effects.fetchImpl = ghl.fetchImpl;
    const email = new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db);
    worker = new OutboxWorker(db, { OUTBOX_WORKER_ENABLED: false, OUTBOX_POLL_MS: 5000, NODE_ENV: 'test' } as never, email, effects);
  });

  it('creates the contact with converted values, then updates the same one, adding the tags only once', async () => {
    await connect();
    const first = await submit(lead);
    expect(await row(first)).toMatchObject({ status: 'done', lastError: null });
    expect(ghl.contacts).toHaveLength(1);
    const contact = ghl.contacts[0]!;
    expect(contact.fields).toMatchObject({ email: 'Sam@Acme.io', companyName: 'Acme', source: 'dForms: Spring webinar' });
    // The live type wins over the stored one: a number goes as a number.
    expect(contact.customFields).toEqual({ 'f-num': 25, 'f-single': 'Pro', 'f-utm': 'linkedin' });
    expect([...contact.tags].sort()).toEqual(['dforms', 'webinar']);
    // Written with the stored token, to the stored location, never with tags in the upsert.
    const [upsert] = upserts();
    expect(upsert!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(upsert!.body!)).toMatchObject({ locationId: LOC });
    expect(JSON.parse(upsert!.body!)).not.toHaveProperty('tags');

    const second = await submit({ ...lead, company: 'Acme Inc' });
    expect(await row(second)).toMatchObject({ status: 'done' });
    expect(ghl.contacts).toHaveLength(1);
    expect(contact.fields.companyName).toBe('Acme Inc');
    expect([...contact.tags].sort()).toEqual(['dforms', 'webinar']);
    expect(await rejectedAt()).toBeNull();
  });

  it('skips a response with no email and no phone, without an upsert', async () => {
    await connect();
    const id = await submit({ company: 'Acme' });
    expect(await row(id)).toMatchObject({ status: 'skipped', lastError: GOHIGHLEVEL_REASONS.noEmailOrPhone });
    expect(upserts()).toHaveLength(0);
  });

  it("skips a value GHL refuses, with GHL's reason, and does not retry it", async () => {
    await connect();
    ghl.state.upsertFails.push({ status: 422, message: ['phone must be a valid phone number', 'email must be an email'] });
    const id = await submit(lead);
    expect(await row(id)).toMatchObject({
      status: 'skipped',
      lastError: 'HTTP 422: phone must be a valid phone number; email must be an email',
    });
    await worker.drainOnce(Date.now() + 60_000);
    expect(upserts()).toHaveLength(1);
    expect(await rejectedAt()).toBeNull();
  });

  it('a revoked token skips with the reconnect reason and marks the connection; reconnecting clears it', async () => {
    await connect();
    ghl.tokens.delete(TOKEN);
    const id = await submit(lead);
    expect(await row(id)).toMatchObject({ status: 'skipped', lastError: GOHIGHLEVEL_REASONS.tokenRejected });
    expect(await rejectedAt()).toEqual(expect.any(Number));
    const card = (await controller.list(asOwner())).providers.find((p) => p.provider === 'gohighlevel');
    expect(card!.rejectedAt).toEqual(expect.any(Number));

    await connect(TOKEN_TWO);
    expect(await rejectedAt()).toBeNull();
    const next = await submit(lead);
    expect(await row(next)).toMatchObject({ status: 'done' });
  });

  it('a refused token does not make every later delivery read the fields again', async () => {
    await connect();
    ghl.tokens.delete(TOKEN);
    const reads = () => ghl.calls.filter((c) => c.path.includes('/customFields')).length;
    const before = reads();
    await submit(lead);
    await submit(lead);
    expect(reads()).toBe(before + 1);
  });

  it('a token that lost access to the location skips and marks the connection', async () => {
    await connect();
    ghl.tokens.get(TOKEN)!.locationId = OTHER_LOC;
    const id = await submit(lead);
    expect(await row(id)).toMatchObject({ status: 'skipped', lastError: GOHIGHLEVEL_REASONS.locationForbidden });
    expect(await rejectedAt()).toEqual(expect.any(Number));
  });

  it.each([429, 503])('retries a %s, then delivers once GHL answers, without a second contact', async (status) => {
    await connect();
    ghl.state.upsertFails.push({ status, message: 'Too many requests' });
    const id = await submit(lead);
    expect(await row(id)).toMatchObject({ status: 'pending', attempts: 1 });
    expect(await rejectedAt()).toBeNull();

    await worker.drainOnce(Date.now() + 60_000);
    expect(await row(id)).toMatchObject({ status: 'done' });
    expect(ghl.contacts).toHaveLength(1);
  });

  it('retries a Cloudflare block and never marks the token', async () => {
    await connect();
    ghl.state.mode = 'cloudflare';
    const id = await submit(lead);
    expect(await row(id)).toMatchObject({ status: 'pending', attempts: 1 });
    expect(await rejectedAt()).toBeNull();
    ghl.state.mode = null;
    await worker.drainOnce(Date.now() + 60_000);
    expect(await row(id)).toMatchObject({ status: 'done' });
  });

  it('retries a dropped connection', async () => {
    await connect();
    ghl.state.mode = 'network';
    const id = await submit(lead);
    expect(await row(id)).toMatchObject({ status: 'pending', attempts: 1 });
    expect(await rejectedAt()).toBeNull();
  });

  it('skips with the reconnect reason, and sends nothing, once the workspace disconnects', async () => {
    await connect();
    await controller.disconnect(asOwner(), 'gohighlevel');
    const before = ghl.calls.length;
    const id = await submit(lead);
    expect(await row(id)).toMatchObject({ status: 'skipped', lastError: GOHIGHLEVEL_REASONS.notConnected });
    expect(ghl.calls.length).toBe(before);
  });
});
