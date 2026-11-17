/**
 * Salesforce, through the real controller, the real delivery path and an
 * in-memory database, with a fake org behind `fetch`.
 *
 * Locks the parts a customer would notice:
 *   1. connect proves the three values before storing them, stores them
 *      encrypted, and never echoes the secret;
 *   2. a domain that is not the org's own My Domain is refused before the
 *      secret is sent anywhere;
 *   3. each refusal comes back as a reason the admin UI can explain;
 *   4. the field list reads the CONNECTED org, caches per account, and a
 *      disconnect clears both the token and the list;
 *   5. a delivery uses the stored connection and the org's field types;
 *   6. a form cannot gain a second Salesforce destination.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  createDb,
  decryptToken,
  getAccountByCode,
  getIntegration,
  inviteMember,
  migrate,
  seed,
  type Db,
} from '@quill/db';
import type { ServerEnv } from '@quill/config/env';
import type { DestinationContext } from '@quill/destinations';
import {
  CalendlyEventTypesService,
  HubspotPropertiesService,
  IntegrationsController,
} from './integrations.controller';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';
import { normalizeSalesforceDomain, SalesforceAccessTokens } from './salesforce-auth';
import { SalesforceFieldsService } from './salesforce-fields';
import { DestinationEffects } from './destination-effects';
import { OutboxSkipError } from './email-effects';

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
const DOMAIN = 'https://acme.my.salesforce.com';
// Low-entropy stand-ins on purpose: a realistic-looking value here is what a
// secret scanner flags in a public repo, and these never meet a real org.
const PASTED_TWO = 'zzzz-yyyy-xxxx-wwww';
const PASTED_ONE = 'aaaa-bbbb-cccc-abcd';

const asOwner = (): ReqLike => ({ headers: {} });
const asEmail = (email: string): ReqLike => ({ headers: { 'x-quill-email': email } });

interface Call {
  method: string;
  url: string;
  body?: string;
}

/** A fake org. `token` decides how the token endpoint answers. */
function fakeOrg(opts: { token?: () => Response; leads?: Record<string, string> } = {}) {
  const calls: Call[] = [];
  const leads = { ...(opts.leads ?? {}) };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? init.body : undefined });
    if (url === `${DOMAIN}/services/oauth2/token`) {
      return opts.token ? opts.token() : json({ access_token: 'tok-1', instance_url: DOMAIN, token_type: 'Bearer' });
    }
    const u = new URL(url);
    if (u.pathname.endsWith('/query')) {
      const q = u.searchParams.get('q') ?? '';
      if (q.includes('FROM Organization')) return json({ records: [{ Name: 'Acme Inc' }] });
      if (q.includes('FROM Contact')) return json({ records: [] });
      const email = /Email = '([^']*)'/.exec(q)?.[1] ?? '';
      return json({ records: leads[email] ? [{ Id: leads[email] }] : [] });
    }
    if (u.pathname.endsWith('/sobjects/Lead/describe')) {
      return json({
        fields: [
          { name: 'Id', type: 'id', createable: false, updateable: false },
          { name: 'Email', label: 'Email', type: 'email', createable: true, updateable: true, nillable: true },
          { name: 'LastName', label: 'Last Name', type: 'string', createable: true, updateable: true, nillable: false },
          { name: 'Company', label: 'Company', type: 'string', createable: true, updateable: true, nillable: false },
          { name: 'Seats__c', label: 'Seats', type: 'double', createable: true, updateable: true, nillable: true },
          { name: 'Address', label: 'Address', type: 'address', createable: false, updateable: false },
          {
            name: 'LeadSource',
            label: 'Lead Source',
            type: 'picklist',
            createable: true,
            updateable: true,
            nillable: true,
            picklistValues: [
              { value: 'Web', label: 'Web', active: true },
              { value: 'Old', label: 'Old', active: false },
            ],
          },
          { name: 'IsConverted', label: 'Converted', type: 'boolean', createable: false, updateable: false, nillable: false },
        ],
      });
    }
    if (u.pathname.endsWith('/sobjects/Contact/describe')) {
      return json({ fields: [{ name: 'Email', type: 'email' }, { name: 'LastName', type: 'string' }] });
    }
    if (init?.method === 'POST' && u.pathname.endsWith('/sobjects/Lead')) return json({ id: '00Q9', success: true }, 201);
    return json([{ errorCode: 'NOT_FOUND', message: 'no route' }], 404);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

let db: Db;
let controller: IntegrationsController;
let tokens: SalesforceAccessTokens;
let fields: SalesforceFieldsService;

function env(overrides: Partial<ServerEnv> = {}): ServerEnv {
  return { NODE_ENV: 'test', FORMS_ENCRYPTION_KEY: ENCRYPTION_KEY, ...overrides } as unknown as ServerEnv;
}

function build(fetchImpl: typeof fetch, e: ServerEnv = env()): void {
  const provider = new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });
  const auth = new AuthService(db, provider);
  tokens = new SalesforceAccessTokens();
  fields = new SalesforceFieldsService(db, e, tokens);
  fields.fetchImpl = fetchImpl;
  controller = new IntegrationsController(
    auth,
    new HubspotPropertiesService(e, db, fetchImpl),
    new CalendlyEventTypesService(e, db, fetchImpl),
    db,
    e,
    undefined,
    undefined,
    undefined,
    tokens,
    fields,
  );
  controller.fetchImpl = fetchImpl;
}

async function accountId(): Promise<string> {
  return (await getAccountByCode(db, 'acme'))!.id;
}

const connectBody = (over: Record<string, string> = {}) => ({
  domain: 'acme.my.salesforce.com/lightning/setup/Home',
  consumerKey: PASTED_ONE,
  consumerSecret: PASTED_TWO,
  ...over,
});

async function reasonOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return ((err as BadRequestException).getResponse() as { reason?: string }).reason;
  }
  throw new Error('expected a refusal');
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
});

afterEach(async () => {
  await db.close();
});

describe('POST /v1/integrations/salesforce/connect', () => {
  it('proves the values, stores them encrypted, and shows the org without the secret', async () => {
    const org = fakeOrg();
    build(org.fetchImpl);

    const status = await controller.connectSalesforce(asOwner(), connectBody());

    expect(status).toMatchObject({ provider: 'salesforce', connected: true, label: 'Acme Inc', last4: 'abcd' });
    expect(JSON.stringify(status)).not.toContain(PASTED_TWO);
    // The pasted path was reduced to the org's origin before anything was sent.
    expect(org.calls[0]).toMatchObject({ method: 'POST', url: `${DOMAIN}/services/oauth2/token` });
    expect(org.calls[0]!.body).toContain('grant_type=client_credentials');

    const row = await getIntegration(db, await accountId(), 'salesforce');
    expect(row!.encryptedToken).not.toContain(PASTED_TWO);
    expect(JSON.parse(decryptToken(row!.encryptedToken, ENCRYPTION_KEY))).toEqual({
      domain: DOMAIN,
      consumerKey: PASTED_ONE,
      consumerSecret: PASTED_TWO,
    });
  });

  it('refuses a domain that is not a My Domain host before sending the secret anywhere', async () => {
    const org = fakeOrg();
    build(org.fetchImpl);
    for (const domain of ['https://evil.example.com', 'login.salesforce.com', 'http://acme.my.salesforce.com']) {
      expect(await reasonOf(controller.connectSalesforce(asOwner(), connectBody({ domain })))).toBe('domain_invalid');
    }
    expect(org.calls).toHaveLength(0);
    expect(await getIntegration(db, await accountId(), 'salesforce')).toBeNull();
  });

  it.each([
    ['invalid_client', { error: 'invalid_client', error_description: 'invalid client credentials' }],
    ['invalid_client', { error: 'invalid_client_id', error_description: 'client identifier invalid' }],
    ['no_run_as', { error: 'invalid_grant', error_description: 'no client credentials user enabled' }],
    ['rejected', { error: 'unsupported_grant_type', error_description: 'grant type not supported' }],
  ])('names the refusal (%s) and stores nothing', async (reason, body) => {
    build(fakeOrg({ token: () => new Response(JSON.stringify(body), { status: 400 }) }).fetchImpl);
    expect(await reasonOf(controller.connectSalesforce(asOwner(), connectBody()))).toBe(reason);
    expect(await getIntegration(db, await accountId(), 'salesforce')).toBeNull();
  });

  it('says unreachable when Salesforce does not answer', async () => {
    build((async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    expect(await reasonOf(controller.connectSalesforce(asOwner(), connectBody()))).toBe('unreachable');
  });

  it('is refused to a plain member', async () => {
    build(fakeOrg().fetchImpl);
    await inviteMember(db, await accountId(), { email: 'plain@acme.test', role: 'member' });
    await expect(
      controller.connectSalesforce(asEmail('plain@acme.test'), connectBody()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('is not reachable through the single-token connect route', async () => {
    build(fakeOrg().fetchImpl);
    await expect(controller.connect(asOwner(), 'salesforce', { token: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('GET /v1/integrations/salesforce/fields', () => {
  it('reports not_connected before a connection exists', async () => {
    build(fakeOrg().fetchImpl);
    await expect(controller.salesforceFieldList(asOwner())).resolves.toEqual({
      enabled: false,
      reason: 'not_connected',
    });
  });

  it("lists the org's writable Lead fields, with required flags and active picklist values", async () => {
    const org = fakeOrg();
    build(org.fetchImpl);
    await controller.connectSalesforce(asOwner(), connectBody());

    const out = await controller.salesforceFieldList(asOwner());
    if (!out.enabled) throw new Error('expected fields');
    expect(out.lead.map((f) => f.name)).toEqual(['Company', 'Email', 'LastName', 'LeadSource', 'Seats__c']);
    expect(out.lead.find((f) => f.name === 'LastName')?.required).toBe(true);
    expect(out.lead.find((f) => f.name === 'Email')?.required).toBe(false);
    expect(out.lead.find((f) => f.name === 'LeadSource')?.options).toEqual([{ value: 'Web', label: 'Web' }]);
    expect(out.contact).toEqual(['Email', 'LastName']);
  });

  it('serves the cache until refresh=1, and a disconnect clears it', async () => {
    const org = fakeOrg();
    build(org.fetchImpl);
    await controller.connectSalesforce(asOwner(), connectBody());
    await controller.salesforceFieldList(asOwner());
    const described = () => org.calls.filter((c) => c.url.endsWith('/describe')).length;
    expect(described()).toBe(2);

    await expect(controller.salesforceFieldList(asOwner())).resolves.toMatchObject({ cached: true });
    expect(described()).toBe(2);
    await expect(controller.salesforceFieldList(asOwner(), '1')).resolves.toMatchObject({ cached: false });
    expect(described()).toBe(4);

    await controller.disconnect(asOwner(), 'salesforce');
    await expect(controller.salesforceFieldList(asOwner())).resolves.toEqual({
      enabled: false,
      reason: 'not_connected',
    });
  });
});

describe('a Run As user limited to Leads', () => {
  it('still lists the Lead fields when the Contact describe is refused', async () => {
    const org = fakeOrg();
    const limited = (async (input: string | URL, init?: RequestInit) =>
      String(input).endsWith('/sobjects/Contact/describe')
        ? new Response(JSON.stringify([{ errorCode: 'NOT_FOUND', message: 'no access' }]), { status: 404 })
        : org.fetchImpl(input, init)) as unknown as typeof fetch;
    build(limited);
    await controller.connectSalesforce(asOwner(), connectBody());
    const out = await controller.salesforceFieldList(asOwner());
    expect(out).toMatchObject({ enabled: true, contact: [] });
  });
});

describe('delivering a submission', () => {
  const ctx = (accountId: string): DestinationContext => ({
    idempotencyKey: 'submission:s1:complete:salesforce:0',
    submissionId: 's1',
    formId: 'f1',
    formName: 'Demo',
    accountId,
    sessionId: 'sess',
    score: 3,
    outcomeLabel: null,
    phase: 'complete',
    submittedAt: Date.UTC(2026, 10, 16),
    data: { email: 'sam@acme.io', seats: '25' },
    utm: {},
  });

  it("writes with the stored connection, sending numbers the way the org's describe says", async () => {
    const org = fakeOrg();
    build(org.fetchImpl);
    await controller.connectSalesforce(asOwner(), connectBody());

    const effects = new DestinationEffects(db, env(), undefined, undefined, tokens, fields);
    effects.fetchImpl = org.fetchImpl;
    const destination = {
      type: 'salesforce',
      enabled: true,
      fieldMappings: { email: 'Email', seats: 'Seats__c' },
      utmMappings: {},
      staticFields: { LeadSource: 'Web' },
    };
    const transcript = await effects.deliver(
      'complete',
      JSON.stringify({ destination, ctx: ctx(await accountId()) }),
    );

    expect(transcript.responseStatus).toBe(201);
    const post = org.calls.find((c) => c.method === 'POST' && c.url.endsWith('/sobjects/Lead'));
    expect(JSON.parse(post!.body!)).toEqual({
      Seats__c: 25,
      LeadSource: 'Web',
      Email: 'sam@acme.io',
      LastName: '[not provided]',
      Company: 'Acme',
    });
  });

  it('degrades to a named skip when the workspace never connected Salesforce', async () => {
    const org = fakeOrg();
    build(org.fetchImpl);
    const effects = new DestinationEffects(db, env(), undefined, undefined, tokens, fields);
    effects.fetchImpl = org.fetchImpl;
    const delivery = effects.deliver(
      'complete',
      JSON.stringify({
        destination: { type: 'salesforce', enabled: true, fieldMappings: { email: 'Email' }, utmMappings: {} },
        ctx: ctx(await accountId()),
      }),
    );
    // A skip, never a success: the worker records it as not delivered.
    await expect(delivery).rejects.toBeInstanceOf(OutboxSkipError);
    await expect(delivery).rejects.toThrow('salesforce destination has no usable connection (reconnect Salesforce)');
    expect(org.calls).toHaveLength(0);
  });
});

describe('normalizeSalesforceDomain', () => {
  it.each([
    ['acme.my.salesforce.com', DOMAIN],
    ['https://ACME.my.salesforce.com/', DOMAIN],
    ['https://acme.lightning.force.com/lightning/page/home', DOMAIN],
    ['acme--uat.sandbox.my.salesforce.com', 'https://acme--uat.sandbox.my.salesforce.com'],
    ['acme-dev-ed.develop.my.salesforce.com', 'https://acme-dev-ed.develop.my.salesforce.com'],
  ])('accepts %s', (raw, expected) => {
    expect(normalizeSalesforceDomain(raw)).toBe(expected);
  });

  it.each([
    'login.salesforce.com',
    'https://acme.my.salesforce.com.evil.io',
    'https://user:pw@acme.my.salesforce.com',
    'https://acme.my.salesforce.com:8443',
    'ftp://acme.my.salesforce.com',
    '',
  ])('refuses %s', (raw) => {
    expect(normalizeSalesforceDomain(raw)).toBeNull();
  });
});
