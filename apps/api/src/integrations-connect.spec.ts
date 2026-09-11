/**
 * Account-level integration connect flow, end to end on in-memory SQLite through
 * the real IntegrationsController → AuthService → provider → db. Locks the
 * paste-token contract:
 *
 *   1. connect VALIDATES the token against the provider before storing it, then
 *      persists it ENCRYPTED and returns a TOKEN-FREE status (last4 + label);
 *   2. a token the provider rejects (401) → 400, nothing stored;
 *   3. connect without a server encryption key → 400 (never calls the provider);
 *   4. GET status lists connections with no token material + encryptionAvailable;
 *   5. DELETE disconnects (idempotent);
 *   6. the HubSpot property picker uses the CONNECTED account token (not the env
 *      fallback), and falls back to env / reports disabled when appropriate;
 *   7. connect/disconnect require an admin/owner (a plain member is refused 403).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  createDb,
  migrate,
  seed,
  getAccountByCode,
  getIntegration,
  decryptToken,
  deleteIntegration,
  inviteMember,
  upsertIntegration,
  type Db,
} from '@quill/db';
import type { ServerEnv } from '@quill/config/env';
import {
  CalendlyEventTypesService,
  HubspotPropertiesService,
  IntegrationsController,
} from './integrations.controller';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';

/** A valid base64-encoded 32-byte encryption key (openssl rand -base64 32 shape). */
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const HUBSPOT_PROPERTIES_URL = 'https://api.hubapi.com/crm/v3/properties/contacts';
const CALENDLY_ME_URL = 'https://api.calendly.com/users/me';

/** No identity → local provider falls back to the first seeded account+member (the owner). */
const asOwner = (): ReqLike => ({ headers: {} });
/** A request the local dev provider resolves to `email` (an existing member). */
const asEmail = (email: string): ReqLike => ({ headers: { 'x-quill-email': email } });

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
}

/** Record every call; answer per-URL from `responses` (default 404). */
function recordingFetch(
  calls: RecordedCall[],
  responses: Record<string, () => Response> = {},
): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const make = responses[url];
    return make ? make() : new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
}

const noopFetch = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let db: Db;
let controller: IntegrationsController;

function makeEnv(overrides: Partial<ServerEnv> = {}): ServerEnv {
  return {
    NODE_ENV: 'test',
    FORMS_ENCRYPTION_KEY: ENCRYPTION_KEY,
    HUBSPOT_PRIVATE_APP_TOKEN: undefined,
    ...overrides,
  } as unknown as ServerEnv;
}

/** Wire the real controller with a swappable fetch (used for both connect + picker). */
function build(
  env: ServerEnv,
  fetchImpl: typeof fetch,
): { hubspot: HubspotPropertiesService; calendly: CalendlyEventTypesService } {
  const provider = new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });
  const auth = new AuthService(db, provider);
  const hubspot = new HubspotPropertiesService(env, db, fetchImpl);
  const calendly = new CalendlyEventTypesService(env, db, fetchImpl);
  controller = new IntegrationsController(auth, hubspot, calendly, db, env);
  controller.fetchImpl = fetchImpl;
  return { hubspot, calendly };
}

async function accountId(): Promise<string> {
  const account = await getAccountByCode(db, 'acme');
  return account!.id;
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db); // account "acme" + owner alex@example.com
});

afterEach(async () => {
  await db.close();
});

describe('POST /v1/integrations/:provider/connect', () => {
  it('validates the token against HubSpot, stores it encrypted, returns a token-free status', async () => {
    const calls: RecordedCall[] = [];
    build(makeEnv(), recordingFetch(calls, { [HUBSPOT_PROPERTIES_URL]: () => jsonResponse({ results: [] }) }));

    const status = await controller.connect(asOwner(), 'hubspot', { token: 'test-secret-1234' });

    // Token-free status (last4 + label only) — never the token itself.
    expect(status).toMatchObject({ provider: 'hubspot', connected: true, last4: '1234', label: 'HubSpot' });
    expect(JSON.stringify(status)).not.toContain('test-secret-1234');

    // Validated with the pasted token against the provider.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(HUBSPOT_PROPERTIES_URL);
    expect(calls[0]!.headers.authorization).toBe('Bearer test-secret-1234');

    // Stored ENCRYPTED (not plaintext), decryptable back to the original.
    const row = await getIntegration(db, await accountId(), 'hubspot');
    expect(row).not.toBeNull();
    expect(row!.encryptedToken).not.toContain('test-secret-1234');
    expect(decryptToken(row!.encryptedToken, ENCRYPTION_KEY)).toBe('test-secret-1234');
    expect(row!.meta?.last4).toBe('1234');
  });

  it('validates a Calendly token via /users/me and derives the label from the user', async () => {
    const calls: RecordedCall[] = [];
    build(
      makeEnv(),
      recordingFetch(calls, {
        [CALENDLY_ME_URL]: () => jsonResponse({ resource: { email: 'rep@acme.io', name: 'Rep' } }),
      }),
    );

    const status = await controller.connect(asOwner(), 'calendly', { token: 'test-cal-7777' });
    expect(status).toMatchObject({ provider: 'calendly', connected: true, last4: '7777', label: 'rep@acme.io' });
    expect(calls[0]!.url).toBe(CALENDLY_ME_URL);
    expect(calls[0]!.headers.authorization).toBe('Bearer test-cal-7777');
  });

  it('rejects a token the provider refuses (401) → 400 with a generic message, nothing stored', async () => {
    const calls: RecordedCall[] = [];
    build(
      makeEnv(),
      recordingFetch(calls, {
        // A provider error body must never leak into the response.
        [HUBSPOT_PROPERTIES_URL]: () => jsonResponse({ message: 'private app token invalid' }, 401),
      }),
    );

    const err = await controller.connect(asOwner(), 'hubspot', { token: 'bad-token' }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({
      message: 'the token was rejected by hubspot',
    });
    // Nothing stored, and the provider's error text never surfaced.
    expect(await getIntegration(db, await accountId(), 'hubspot')).toBeNull();
    expect(JSON.stringify((err as BadRequestException).getResponse())).not.toContain('private app token invalid');
  });

  it('without a server encryption key → 400, and the provider is never called', async () => {
    const calls: RecordedCall[] = [];
    build(makeEnv({ FORMS_ENCRYPTION_KEY: '' }), recordingFetch(calls, {}));

    const err = await controller.connect(asOwner(), 'hubspot', { token: 'whatever' }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({
      message: 'server encryption key not configured',
    });
    expect(calls).toHaveLength(0); // short-circuited before any provider call
    expect(await getIntegration(db, await accountId(), 'hubspot')).toBeNull();
  });

  it('rejects an unknown provider with 400', async () => {
    build(makeEnv(), noopFetch);
    await expect(controller.connect(asOwner(), 'salesforce', { token: 't' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a missing/blank token with 400', async () => {
    build(makeEnv(), noopFetch);
    await expect(controller.connect(asOwner(), 'hubspot', { token: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.connect(asOwner(), 'hubspot', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('requires an admin/owner — a plain member is refused 403 (nothing stored)', async () => {
    const calls: RecordedCall[] = [];
    build(makeEnv(), recordingFetch(calls, { [HUBSPOT_PROPERTIES_URL]: () => jsonResponse({ results: [] }) }));
    await inviteMember(db, await accountId(), { email: 'plain@acme.test', role: 'member' });

    await expect(
      controller.connect(asEmail('plain@acme.test'), 'hubspot', { token: 'tok-1234' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(calls).toHaveLength(0); // refused before touching the provider
    expect(await getIntegration(db, await accountId(), 'hubspot')).toBeNull();
  });

  it('re-connect overwrites the stored token for the same provider', async () => {
    const calls: RecordedCall[] = [];
    build(makeEnv(), recordingFetch(calls, { [HUBSPOT_PROPERTIES_URL]: () => jsonResponse({ results: [] }) }));

    await controller.connect(asOwner(), 'hubspot', { token: 'test-first-0001' });
    const status = await controller.connect(asOwner(), 'hubspot', { token: 'test-second-0002' });
    expect(status.last4).toBe('0002');

    const row = await getIntegration(db, await accountId(), 'hubspot');
    expect(decryptToken(row!.encryptedToken, ENCRYPTION_KEY)).toBe('test-second-0002');
    // Still exactly one row for (account, hubspot).
    expect((await controller.list(asOwner())).providers.filter((p) => p.provider === 'hubspot')).toHaveLength(1);
  });
});

describe('GET /v1/integrations (status)', () => {
  it('lists connections with no token material + reports encryptionAvailable', async () => {
    const calls: RecordedCall[] = [];
    build(makeEnv(), recordingFetch(calls, { [HUBSPOT_PROPERTIES_URL]: () => jsonResponse({ results: [] }) }));
    await controller.connect(asOwner(), 'hubspot', { token: 'tok-abcd' });

    const out = await controller.list(asOwner());
    expect(out.encryptionAvailable).toBe(true);
    expect(out.providers).toHaveLength(1);
    expect(out.providers[0]).toMatchObject({
      provider: 'hubspot',
      connected: true,
      last4: 'abcd',
      label: 'HubSpot',
    });
    // No token material of any kind in the payload.
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('tok-abcd');
    expect(serialized).not.toContain('encryptedToken');
  });

  it('reports encryptionAvailable=false and no connections on a bare setup', async () => {
    build(makeEnv({ FORMS_ENCRYPTION_KEY: '' }), noopFetch);
    const out = await controller.list(asOwner());
    expect(out.encryptionAvailable).toBe(false);
    expect(out.providers).toEqual([]);
  });
});

describe('DELETE /v1/integrations/:provider', () => {
  it('disconnects the provider (idempotent)', async () => {
    const calls: RecordedCall[] = [];
    build(makeEnv(), recordingFetch(calls, { [HUBSPOT_PROPERTIES_URL]: () => jsonResponse({ results: [] }) }));
    await controller.connect(asOwner(), 'hubspot', { token: 'tok-xyz9' });
    expect(await getIntegration(db, await accountId(), 'hubspot')).not.toBeNull();

    await controller.disconnect(asOwner(), 'hubspot');
    expect(await getIntegration(db, await accountId(), 'hubspot')).toBeNull();
    expect((await controller.list(asOwner())).providers).toHaveLength(0);

    // Idempotent: a second disconnect is a no-op, not an error.
    await expect(controller.disconnect(asOwner(), 'hubspot')).resolves.toBeUndefined();
  });

  it('requires an admin/owner — a plain member is refused 403', async () => {
    build(makeEnv(), noopFetch);
    await inviteMember(db, await accountId(), { email: 'plain@acme.test', role: 'member' });
    await expect(controller.disconnect(asEmail('plain@acme.test'), 'hubspot')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('HubSpot property picker token resolution', () => {
  it('uses the CONNECTED account token, not the env fallback', async () => {
    const calls: RecordedCall[] = [];
    build(
      makeEnv({ HUBSPOT_PRIVATE_APP_TOKEN: 'env-fallback-token' }),
      recordingFetch(calls, {
        [HUBSPOT_PROPERTIES_URL]: () =>
          jsonResponse({ results: [{ name: 'email', label: 'Email', type: 'string' }] }),
      }),
    );
    // Connect an account token (this validates once against the same URL).
    await controller.connect(asOwner(), 'hubspot', { token: 'account-token-9999' });

    const res = await controller.hubspotProperties(asOwner());
    expect(res.enabled).toBe(true);
    if (res.enabled) expect(res.properties.map((prop) => prop.name)).toContain('email');

    // The picker call carried the ACCOUNT token, never the env fallback.
    const picker = calls[calls.length - 1]!;
    expect(picker.url).toBe(HUBSPOT_PROPERTIES_URL);
    expect(picker.headers.authorization).toBe('Bearer account-token-9999');
  });

  it('falls back to the env token when the account is not connected', async () => {
    const calls: RecordedCall[] = [];
    build(
      makeEnv({ HUBSPOT_PRIVATE_APP_TOKEN: 'env-fallback-token' }),
      recordingFetch(calls, { [HUBSPOT_PROPERTIES_URL]: () => jsonResponse({ results: [] }) }),
    );
    const res = await controller.hubspotProperties(asOwner());
    expect(res.enabled).toBe(true);
    expect(calls[calls.length - 1]!.headers.authorization).toBe('Bearer env-fallback-token');
  });

  it('reports disabled when neither an account nor an env token exists', async () => {
    build(makeEnv({ HUBSPOT_PRIVATE_APP_TOKEN: undefined }), noopFetch);
    const res = await controller.hubspotProperties(asOwner());
    expect(res.enabled).toBe(false);
  });

  it('passes enumeration options through — hidden dropped, order kept, text omitted', async () => {
    build(
      makeEnv({ HUBSPOT_PRIVATE_APP_TOKEN: 'env-fallback-token' }),
      recordingFetch([], {
        [HUBSPOT_PROPERTIES_URL]: () =>
          jsonResponse({
            results: [
              // Deliberately NOT alphabetical, and with the retired value in the
              // middle: the mapping must keep HubSpot's order and drop `hidden`.
              {
                name: 'company_size',
                label: 'Company size',
                type: 'enumeration',
                options: [
                  { value: '2', label: '11-50 employees' },
                  { value: 'legacy', label: 'Retired bucket', hidden: true },
                  { value: '1', label: '1-10 employees' },
                  // No `value` — nothing to write, so nothing to offer.
                  { label: 'Malformed' },
                ],
              },
              { name: 'email', label: 'Email', type: 'string' },
              // An enumeration whose options are ALL hidden is not a picklist an
              // author can use — it must come back like a text property.
              {
                name: 'dead_enum',
                label: 'Dead enum',
                type: 'enumeration',
                options: [{ value: 'x', label: 'X', hidden: true }],
              },
            ],
          }),
      }),
    );
    const res = await controller.hubspotProperties(asOwner());
    expect(res.enabled).toBe(true);
    if (!res.enabled) return;
    const by = (name: string) => res.properties.find((p) => p.name === name)!;

    expect(by('company_size').options).toEqual([
      { value: '2', label: '11-50 employees' },
      { value: '1', label: '1-10 employees' },
    ]);
    // Absent, never `[]` — `options?.length` is the whole picklist test in the UI.
    expect(by('email')).not.toHaveProperty('options');
    expect(by('dead_enum')).not.toHaveProperty('options');

    // Properties themselves stay sorted by label, as before.
    expect(res.properties.map((p) => p.label)).toEqual(['Company size', 'Dead enum', 'Email']);
  });

  it('serves options from the per-account cache on the second call', async () => {
    const calls: RecordedCall[] = [];
    build(
      makeEnv({ HUBSPOT_PRIVATE_APP_TOKEN: 'env-fallback-token' }),
      recordingFetch(calls, {
        [HUBSPOT_PROPERTIES_URL]: () =>
          jsonResponse({
            results: [
              { name: 'tier', label: 'Tier', type: 'enumeration', options: [{ value: 'a', label: 'A' }] },
            ],
          }),
      }),
    );
    const first = await controller.hubspotProperties(asOwner());
    const second = await controller.hubspotProperties(asOwner());
    expect(calls).toHaveLength(1);
    expect(second.enabled && second.cached).toBe(true);
    expect(second.enabled && second.properties).toEqual(first.enabled && first.properties);
  });
});

describe('Calendly event-type picker token resolution', () => {
  const CALENDLY_EVENT_TYPES_BASE = 'https://api.calendly.com/event_types';
  const ME = { resource: { uri: 'https://api.calendly.com/users/U1', email: 'rep@acme.io' } };
  const EVENT_TYPES = {
    collection: [
      {
        uri: 'et/2',
        name: 'Demo 30m',
        scheduling_url: 'https://calendly.com/acme/demo',
        active: true,
        duration: 30,
        // Deliberately out of array order + one disabled, to prove the id comes
        // from `position` (Calendly prefills a custom question as a<position+1>)
        // and that a disabled question is never offered for mapping.
        custom_questions: [
          { name: 'Phone number', position: 1, enabled: true, required: true },
          { name: 'What do you need?', position: 0, enabled: true, required: false },
          { name: 'Retired question', position: 2, enabled: false },
        ],
      },
      { uri: 'et/1', name: 'Intro 15m', scheduling_url: 'https://calendly.com/acme/intro', active: true, duration: 15 },
      { uri: 'et/3', name: 'No page', active: true }, // dropped: no scheduling_url
    ],
  };

  /** Answers /users/me exactly and /event_types by prefix (it carries a query). */
  function calendlyFetch(calls: RecordedCall[], me: unknown, list: unknown): typeof fetch {
    return (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      if (url === CALENDLY_ME_URL) return jsonResponse(me);
      if (url.startsWith(CALENDLY_EVENT_TYPES_BASE)) return jsonResponse(list);
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
  }

  it('uses the CONNECTED account token, scopes to its user, and returns sorted event types', async () => {
    const calls: RecordedCall[] = [];
    build(makeEnv(), calendlyFetch(calls, ME, EVENT_TYPES));
    await controller.connect(asOwner(), 'calendly', { token: 'cal-account-8888' });

    const res = await controller.calendlyEventTypes(asOwner());
    expect(res.enabled).toBe(true);
    if (res.enabled) {
      // Sorted by name; the entry with no scheduling_url is dropped.
      expect(res.eventTypes.map((e) => e.name)).toEqual(['Demo 30m', 'Intro 15m']);
      expect(res.eventTypes[0]).toMatchObject({
        schedulingUrl: 'https://calendly.com/acme/demo',
        durationMinutes: 30,
      });
    }
    // Every call carried the ACCOUNT token, and the list was scoped to the user.
    expect(calls.every((c) => c.headers.authorization === 'Bearer cal-account-8888')).toBe(true);
    expect(
      calls.some((c) => c.url.includes(`user=${encodeURIComponent(ME.resource.uri)}`)),
    ).toBe(true);
  });

  it('exposes each event type’s own custom questions by their POSITIONAL id', async () => {
    const calls: RecordedCall[] = [];
    build(makeEnv(), calendlyFetch(calls, ME, EVENT_TYPES));
    await controller.connect(asOwner(), 'calendly', { token: 'cal-account-8888' });

    const res = await controller.calendlyEventTypes(asOwner());
    expect(res.enabled).toBe(true);
    if (!res.enabled) return;
    const demo = res.eventTypes.find((e) => e.name === 'Demo 30m')!;
    // position 1 → a2, position 0 → a1; the disabled one is dropped entirely.
    expect(demo.customQuestions).toEqual([
      { id: 'a2', label: 'Phone number', required: true },
      { id: 'a1', label: 'What do you need?', required: false },
    ]);
    // An event type with no custom questions simply has none (name + email only).
    expect(res.eventTypes.find((e) => e.name === 'Intro 15m')!.customQuestions).toEqual([]);
  });

  it('reports disabled when no Calendly token exists', async () => {
    build(makeEnv({ CALENDLY_API_TOKEN: undefined }), noopFetch);
    const res = await controller.calendlyEventTypes(asOwner());
    expect(res.enabled).toBe(false);
  });
});

describe('provider metadata cache token identity', () => {
  const HUBSPOT_TOKEN_A = 'cache-token-å';
  const HUBSPOT_TOKEN_B = ' cache-token-å ';
  const CALENDLY_EVENT_TYPES_BASE = 'https://api.calendly.com/event_types';

  function authorizationToken(init?: RequestInit): string {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    return headers.authorization?.replace(/^Bearer /, '') ?? '';
  }

  function hubspotFetchByToken(
    calls: RecordedCall[],
    propertyByToken: Record<string, string>,
  ): typeof fetch {
    return (async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, headers });
      const property = propertyByToken[authorizationToken(init)] ?? 'unexpected';
      return jsonResponse({ results: [{ name: property, label: property, type: 'string' }] });
    }) as unknown as typeof fetch;
  }

  function calendlyFetchByToken(
    calls: RecordedCall[],
    identityByToken: Record<string, string>,
  ): typeof fetch {
    return (async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, headers });
      const identity = identityByToken[authorizationToken(init)] ?? 'unexpected';
      if (url === CALENDLY_ME_URL) {
        return jsonResponse({ resource: { uri: `https://api.calendly.com/users/${identity}` } });
      }
      if (url.startsWith(CALENDLY_EVENT_TYPES_BASE)) {
        return jsonResponse({
          collection: [
            {
              uri: `event/${identity}`,
              name: identity,
              scheduling_url: `https://calendly.com/test/${identity.toLowerCase()}`,
              active: true,
            },
          ],
        });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
  }

  function expectHubspotProperty(
    response: Awaited<ReturnType<HubspotPropertiesService['listProperties']>>,
    property: string,
  ): void {
    expect(response.enabled).toBe(true);
    if (response.enabled) expect(response.properties.map((item) => item.name)).toEqual([property]);
  }

  function expectCalendlyEvent(
    response: Awaited<ReturnType<CalendlyEventTypesService['listEventTypes']>>,
    eventName: string,
  ): void {
    expect(response.enabled).toBe(true);
    if (response.enabled) expect(response.eventTypes.map((item) => item.name)).toEqual([eventName]);
  }

  it('rotates HubSpot from A to B across the picker and mirror service chokepoint', async () => {
    const id = await accountId();
    const calls: RecordedCall[] = [];
    await upsertIntegration(db, id, 'hubspot', HUBSPOT_TOKEN_A, ENCRYPTION_KEY);
    const { hubspot } = build(
      makeEnv(),
      hubspotFetchByToken(calls, {
        [HUBSPOT_TOKEN_A]: 'from-a',
        [HUBSPOT_TOKEN_B]: 'from-b',
      }),
    );

    expectHubspotProperty(await controller.hubspotProperties(asOwner()), 'from-a');
    await upsertIntegration(db, id, 'hubspot', HUBSPOT_TOKEN_B, ENCRYPTION_KEY);
    const rotated = await hubspot.listProperties(id);

    expectHubspotProperty(rotated, 'from-b');
    expect(rotated.enabled && rotated.cached).toBe(false);
    expect(calls.map((call) => authorizationToken({ headers: call.headers }))).toEqual([
      HUBSPOT_TOKEN_A,
      HUBSPOT_TOKEN_B,
    ]);
  });

  it('rotates both HubSpot service instances sharing one database', async () => {
    const id = await accountId();
    const calls: RecordedCall[] = [];
    const fetchImpl = hubspotFetchByToken(calls, {
      [HUBSPOT_TOKEN_A]: 'from-a',
      [HUBSPOT_TOKEN_B]: 'from-b',
    });
    const env = makeEnv();
    const first = new HubspotPropertiesService(env, db, fetchImpl);
    const second = new HubspotPropertiesService(env, db, fetchImpl);
    await upsertIntegration(db, id, 'hubspot', HUBSPOT_TOKEN_A, ENCRYPTION_KEY);

    expectHubspotProperty(await first.listProperties(id), 'from-a');
    expectHubspotProperty(await second.listProperties(id), 'from-a');
    await upsertIntegration(db, id, 'hubspot', HUBSPOT_TOKEN_B, ENCRYPTION_KEY);
    expectHubspotProperty(await first.listProperties(id), 'from-b');
    expectHubspotProperty(await second.listProperties(id), 'from-b');

    expect(calls.map((call) => authorizationToken({ headers: call.headers }))).toEqual([
      HUBSPOT_TOKEN_A,
      HUBSPOT_TOKEN_A,
      HUBSPOT_TOKEN_B,
      HUBSPOT_TOKEN_B,
    ]);
  });

  it('reuses HubSpot cache after reconnecting the same token', async () => {
    const id = await accountId();
    const calls: RecordedCall[] = [];
    const service = new HubspotPropertiesService(
      makeEnv(),
      db,
      hubspotFetchByToken(calls, { [HUBSPOT_TOKEN_A]: 'from-a' }),
    );
    await upsertIntegration(db, id, 'hubspot', HUBSPOT_TOKEN_A, ENCRYPTION_KEY);
    expectHubspotProperty(await service.listProperties(id), 'from-a');

    await upsertIntegration(db, id, 'hubspot', HUBSPOT_TOKEN_A, ENCRYPTION_KEY);
    const reused = await service.listProperties(id);

    expectHubspotProperty(reused, 'from-a');
    expect(reused.enabled && reused.cached).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('misses HubSpot cache after disconnecting to a different env fallback', async () => {
    const id = await accountId();
    const calls: RecordedCall[] = [];
    const envFallbackToken = 'env-fallback-token-b';
    const service = new HubspotPropertiesService(
      makeEnv({ HUBSPOT_PRIVATE_APP_TOKEN: envFallbackToken }),
      db,
      hubspotFetchByToken(calls, {
        [HUBSPOT_TOKEN_A]: 'from-a',
        [envFallbackToken]: 'from-b',
      }),
    );
    await upsertIntegration(db, id, 'hubspot', HUBSPOT_TOKEN_A, ENCRYPTION_KEY);
    expectHubspotProperty(await service.listProperties(id), 'from-a');

    await deleteIntegration(db, id, 'hubspot');
    expectHubspotProperty(await service.listProperties(id), 'from-b');
    expect(calls.map((call) => authorizationToken({ headers: call.headers }))).toEqual([
      HUBSPOT_TOKEN_A,
      envFallbackToken,
    ]);
  });

  it('never serves late A data to B after B has already completed', async () => {
    const id = await accountId();
    const calls: RecordedCall[] = [];
    let releaseA!: () => void;
    let markAStarted!: () => void;
    const aGate = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const aStarted = new Promise<void>((resolve) => {
      markAStarted = resolve;
    });
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, headers });
      const token = authorizationToken(init);
      if (token === HUBSPOT_TOKEN_A) {
        markAStarted();
        await aGate;
      }
      const property = token === HUBSPOT_TOKEN_A ? 'from-a' : 'from-b';
      return jsonResponse({ results: [{ name: property, label: property, type: 'string' }] });
    }) as unknown as typeof fetch;
    const service = new HubspotPropertiesService(makeEnv(), db, fetchImpl);
    await upsertIntegration(db, id, 'hubspot', HUBSPOT_TOKEN_A, ENCRYPTION_KEY);

    const lateA = service.listProperties(id);
    await aStarted;
    await upsertIntegration(db, id, 'hubspot', HUBSPOT_TOKEN_B, ENCRYPTION_KEY);
    expectHubspotProperty(await service.listProperties(id), 'from-b');
    releaseA();
    expectHubspotProperty(await lateA, 'from-a');
    expectHubspotProperty(await service.listProperties(id), 'from-b');

    expect(calls.map((call) => authorizationToken({ headers: call.headers }))).toEqual([
      HUBSPOT_TOKEN_A,
      HUBSPOT_TOKEN_B,
      HUBSPOT_TOKEN_B,
    ]);
  });

  it('rotates Calendly from A to B and uses B for both provider calls', async () => {
    const id = await accountId();
    const tokenA = 'cal-token-a';
    const tokenB = 'cal-token-b';
    const calls: RecordedCall[] = [];
    const service = new CalendlyEventTypesService(
      makeEnv(),
      db,
      calendlyFetchByToken(calls, { [tokenA]: 'A', [tokenB]: 'B' }),
    );
    await upsertIntegration(db, id, 'calendly', tokenA, ENCRYPTION_KEY);
    expectCalendlyEvent(await service.listEventTypes(id), 'A');

    await upsertIntegration(db, id, 'calendly', tokenB, ENCRYPTION_KEY);
    const rotated = await service.listEventTypes(id);

    expectCalendlyEvent(rotated, 'B');
    expect(rotated.enabled && rotated.cached).toBe(false);
    expect(calls.slice(2).map((call) => authorizationToken({ headers: call.headers }))).toEqual([
      tokenB,
      tokenB,
    ]);
  });

  it('keeps HubSpot cache data isolated between accounts', async () => {
    const calls: RecordedCall[] = [];
    let fetchNumber = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, headers });
      fetchNumber += 1;
      const property = fetchNumber === 1 ? 'account-a' : 'account-b';
      return jsonResponse({ results: [{ name: property, label: property, type: 'string' }] });
    }) as unknown as typeof fetch;
    const service = new HubspotPropertiesService(
      makeEnv({ HUBSPOT_PRIVATE_APP_TOKEN: 'shared-env-token' }),
      db,
      fetchImpl,
    );

    expectHubspotProperty(await service.listProperties('account-a'), 'account-a');
    expectHubspotProperty(await service.listProperties('account-b'), 'account-b');
    expectHubspotProperty(await service.listProperties('account-a'), 'account-a');
    expect(calls).toHaveLength(2);
  });

  it('does not expose tokens or fingerprints in provider responses', async () => {
    const id = await accountId();
    const hubspotToken = 'hubspot-private-response-token';
    const calendlyToken = 'calendly-private-response-token';
    await upsertIntegration(db, id, 'hubspot', hubspotToken, ENCRYPTION_KEY);
    await upsertIntegration(db, id, 'calendly', calendlyToken, ENCRYPTION_KEY);
    const hubspot = new HubspotPropertiesService(
      makeEnv(),
      db,
      hubspotFetchByToken([], { [hubspotToken]: 'safe-property' }),
    );
    const calendly = new CalendlyEventTypesService(
      makeEnv(),
      db,
      calendlyFetchByToken([], { [calendlyToken]: 'Safe' }),
    );

    const serialized = JSON.stringify({
      hubspot: await hubspot.listProperties(id),
      calendly: await calendly.listEventTypes(id),
    });
    for (const token of [hubspotToken, calendlyToken]) {
      expect(serialized).not.toContain(token);
      expect(serialized).not.toContain(createHash('sha256').update(token, 'utf8').digest('hex'));
    }
    expect(serialized).not.toContain('credentialFingerprint');
  });

  it('refetches HubSpot with the same token at TTL plus one', async () => {
    const calls: RecordedCall[] = [];
    const service = new HubspotPropertiesService(
      makeEnv({ HUBSPOT_PRIVATE_APP_TOKEN: HUBSPOT_TOKEN_A }),
      db,
      hubspotFetchByToken(calls, { [HUBSPOT_TOKEN_A]: 'from-a' }),
    );
    const start = 10_000;

    expectHubspotProperty(await service.listProperties('ttl-account', start), 'from-a');
    const expired = await service.listProperties('ttl-account', start + 5 * 60 * 1000 + 1);

    expectHubspotProperty(expired, 'from-a');
    expect(expired.enabled && expired.cached).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('does not cache a failed HubSpot provider response', async () => {
    let attempt = 0;
    const fetchImpl = (async () => {
      attempt += 1;
      return attempt === 1
        ? new Response('{}', { status: 503 })
        : jsonResponse({ results: [{ name: 'recovered', label: 'Recovered', type: 'string' }] });
    }) as unknown as typeof fetch;
    const service = new HubspotPropertiesService(
      makeEnv({ HUBSPOT_PRIVATE_APP_TOKEN: HUBSPOT_TOKEN_A }),
      db,
      fetchImpl,
    );

    expect((await service.listProperties('failure-account')).enabled).toBe(false);
    expectHubspotProperty(await service.listProperties('failure-account'), 'recovered');
    expect(attempt).toBe(2);
  });
});
