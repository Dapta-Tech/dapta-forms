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
import { describe, it, expect, expectTypeOf, beforeEach, afterEach, vi } from 'vitest';
import { BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import {
  createDb,
  migrate,
  seed,
  getAccountByCode,
  getIntegration,
  decryptToken,
  inviteMember,
  resolveProviderToken,
  upsertIntegration,
  deleteIntegration,
  encryptToken,
  jsonParam,
  sql,
  type Db,
  type ProviderCredentialRevision,
} from '@quill/db';
import { loadServerEnv, type ServerEnv } from '@quill/config/env';
import {
  AccountMetadataCache,
  CalendlyEventTypesService,
  HubspotPropertiesService,
  IntegrationsController,
  type HubSpotPropertyDto,
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

let db: Db;
let controller: IntegrationsController;

function makeEnv(overrides: Partial<ServerEnv> = {}): ServerEnv {
  return {
    NODE_ENV: 'test',
    FORMS_ENCRYPTION_KEY: ENCRYPTION_KEY,
    HUBSPOT_PRIVATE_APP_TOKEN: undefined,
    INTEGRATION_CREDENTIAL_WRITERS: 'generation-only',
    INTEGRATION_CREDENTIAL_WRITERS_ACK: 'all-writers-generation-aware',
    INTEGRATION_CREDENTIAL_WRITER_ATTESTATION_ID: 'chg-1234',
    ...overrides,
  } as unknown as ServerEnv;
}

/** Wire the real controller with a swappable fetch (used for both connect + picker). */
function createController(
  env: ServerEnv,
  fetchImpl: typeof fetch,
): { controller: IntegrationsController; hubspot: HubspotPropertiesService; calendly: CalendlyEventTypesService } {
  const provider = new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });
  const auth = new AuthService(db, provider);
  const hubspot = new HubspotPropertiesService(env, db, env.INTEGRATION_CREDENTIAL_WRITERS, fetchImpl);
  const calendly = new CalendlyEventTypesService(env, db, env.INTEGRATION_CREDENTIAL_WRITERS, fetchImpl);
  const instance = new IntegrationsController(
    auth,
    hubspot,
    calendly,
    db,
    env,
    env.INTEGRATION_CREDENTIAL_WRITERS,
  );
  instance.fetchImpl = fetchImpl;
  return { controller: instance, hubspot, calendly };
}

function build(
  env: ServerEnv,
  fetchImpl: typeof fetch,
): { controller: IntegrationsController; hubspot: HubspotPropertiesService; calendly: CalendlyEventTypesService } {
  const built = createController(env, fetchImpl);
  controller = built.controller;
  return built;
}

async function accountId(): Promise<string> {
  const account = await getAccountByCode(db, 'acme');
  return account!.id;
}

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
  await seed(db); // account "acme" + owner alex@example.com
  const account = await getAccountByCode(db, 'acme');
  if (account) {
    await deleteIntegration(db, account.id, 'hubspot');
    await deleteIntegration(db, account.id, 'calendly');
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.close();
});

describe('AccountMetadataCache', () => {
  it('accepts only metadata and opaque revisions at its write boundary', async () => {
    const cache = new AccountMetadataCache<HubSpotPropertyDto[]>('generation-only');
    const credential = await resolveProviderToken(
      db,
      await accountId(),
      'hubspot',
      ENCRYPTION_KEY,
      'cache-fallback-token',
    );
    if (!credential) throw new Error('expected fallback credential');
    expectTypeOf(cache.setIfCurrent).parameter(1).toEqualTypeOf<ProviderCredentialRevision>();
    expectTypeOf(cache.setIfCurrent).parameter(2).toEqualTypeOf<ProviderCredentialRevision>();
    expectTypeOf(cache.setIfCurrent).parameter(3).toEqualTypeOf<HubSpotPropertyDto[]>();
    type Assert<T extends true> = T;
    type _RawCredentialCannotBeRevision = Assert<string extends ProviderCredentialRevision ? false : true>;
    type StoredRevisionKeys = keyof Extract<ProviderCredentialRevision, { kind: 'stored' }>;
    type _NoTokenRevisionKey = Assert<'token' extends StoredRevisionKeys ? false : true>;
    type _NoHashRevisionKey = Assert<'hash' extends StoredRevisionKeys ? false : true>;
    type _NoMetaRevisionKey = Assert<'meta' extends StoredRevisionKeys ? false : true>;
    type _NoLast4RevisionKey = Assert<'last4' extends StoredRevisionKeys ? false : true>;
    type _NoUpdatedAtRevisionKey = Assert<'updatedAt' extends StoredRevisionKeys ? false : true>;
    // @ts-expect-error Cache data must be provider metadata, never raw credential strings.
    type _RawTokenCache = AccountMetadataCache<string[]>;
    const first = [{ name: 'first_property', label: 'First property', type: 'string' }];
    const second = [{ name: 'second_property', label: 'Second property', type: 'string' }];

    expect(cache.setIfCurrent('first-account', credential.revision, credential.revision, first, 1_000)).toBe(true);
    expect(cache.setIfCurrent('second-account', credential.revision, credential.revision, second, 1_000)).toBe(true);
    await upsertIntegration(db, await accountId(), 'hubspot', 'metadata-cache-account-token', ENCRYPTION_KEY);
    const current = await resolveProviderToken(db, await accountId(), 'hubspot', ENCRYPTION_KEY, undefined);
    if (!current) throw new Error('expected stored credential');
    expect(cache.setIfCurrent('stale-account', credential.revision, current.revision, first, 1_000)).toBe(false);
    cache.invalidate('first-account');

    expect(cache.get('first-account', credential.revision, 1_001)).toBeUndefined();
    expect(cache.get('second-account', credential.revision, 1_001)).toEqual(second);
    expect(cache.get('stale-account', current.revision, 1_001)).toBeUndefined();
  });
});

describe('integration credential writer configuration', () => {
  it('defaults to mixed and requires exact generation-only acknowledgment and attestation ID', () => {
    expect(loadServerEnv({}).INTEGRATION_CREDENTIAL_WRITERS).toBe('mixed');
    expect(() => loadServerEnv({ INTEGRATION_CREDENTIAL_WRITERS: 'unsafe' })).toThrow(
      'INTEGRATION_CREDENTIAL_WRITERS',
    );
    expect(() => loadServerEnv({ INTEGRATION_CREDENTIAL_WRITERS: 'generation-only' })).toThrow(
      'INTEGRATION_CREDENTIAL_WRITERS_ACK=all-writers-generation-aware',
    );
    expect(() =>
      loadServerEnv({
        INTEGRATION_CREDENTIAL_WRITERS: 'generation-only',
        INTEGRATION_CREDENTIAL_WRITERS_ACK: 'wrong',
      }),
    ).toThrow('INTEGRATION_CREDENTIAL_WRITERS_ACK=all-writers-generation-aware');
    expect(() =>
      loadServerEnv({
        INTEGRATION_CREDENTIAL_WRITERS: 'generation-only',
        INTEGRATION_CREDENTIAL_WRITERS_ACK: 'all-writers-generation-aware',
      }),
    ).toThrow('INTEGRATION_CREDENTIAL_WRITER_ATTESTATION_ID');
    expect(() =>
      loadServerEnv({
        INTEGRATION_CREDENTIAL_WRITERS: 'generation-only',
        INTEGRATION_CREDENTIAL_WRITERS_ACK: 'all-writers-generation-aware',
        INTEGRATION_CREDENTIAL_WRITER_ATTESTATION_ID: 'bad id',
      }),
    ).toThrow('INTEGRATION_CREDENTIAL_WRITER_ATTESTATION_ID');
    expect(
      loadServerEnv({
        INTEGRATION_CREDENTIAL_WRITERS: 'generation-only',
        INTEGRATION_CREDENTIAL_WRITERS_ACK: 'all-writers-generation-aware',
        INTEGRATION_CREDENTIAL_WRITER_ATTESTATION_ID: 'chg-1234',
      }).INTEGRATION_CREDENTIAL_WRITERS,
    ).toBe('generation-only');
    expect(loadServerEnv({ INTEGRATION_CREDENTIAL_WRITERS: 'mixed' }).INTEGRATION_CREDENTIAL_WRITERS).toBe(
      'mixed',
    );
    expect(
      loadServerEnv({
        INTEGRATION_CREDENTIAL_WRITERS: 'mixed',
        INTEGRATION_CREDENTIAL_WRITERS_ACK: 'wrong',
        INTEGRATION_CREDENTIAL_WRITER_ATTESTATION_ID: 'bad id',
      }).INTEGRATION_CREDENTIAL_WRITERS,
    ).toBe('mixed');
  });

  it('logs mixed once and skips the migration probe', async () => {
    const probe = vi.fn(async () => undefined);
    const missingDb = { dialect: 'sqlite', get: probe } as unknown as Db;
    const env = makeEnv({ INTEGRATION_CREDENTIAL_WRITERS: 'mixed' });
    const provider = new LocalAuthProvider(db, {
      NODE_ENV: 'test',
      DEV_LOGIN_EMAIL: undefined,
      AUTH_LOCAL_STRICT: undefined,
      SEED_DEMO_FORM: false,
      ONBOARDING_WIZARD: false,
    });
    const auth = new AuthService(db, provider);
    const controllerForBoot = new IntegrationsController(
      auth,
      new HubspotPropertiesService(env, missingDb, 'mixed', noopFetch),
      new CalendlyEventTypesService(env, missingDb, 'mixed', noopFetch),
      missingDb,
      env,
      'mixed',
    );
    const log = vi.spyOn(Logger.prototype, 'log');

    await expect(controllerForBoot.onModuleInit()).resolves.toBeUndefined();
    expect(probe).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('integration credential writers=mixed');
  });

  it('refuses generation-only before migration 0015 is available', async () => {
    const missingDb = {
      dialect: 'sqlite',
      get: async () => undefined,
    } as unknown as Db;
    const env = makeEnv({ INTEGRATION_CREDENTIAL_WRITERS: 'generation-only' });
    const provider = new LocalAuthProvider(db, {
      NODE_ENV: 'test',
      DEV_LOGIN_EMAIL: undefined,
      AUTH_LOCAL_STRICT: undefined,
      SEED_DEMO_FORM: false,
      ONBOARDING_WIZARD: false,
    });
    const auth = new AuthService(db, provider);
    const controllerForBoot = new IntegrationsController(
      auth,
      new HubspotPropertiesService(env, missingDb, 'generation-only', noopFetch),
      new CalendlyEventTypesService(env, missingDb, 'generation-only', noopFetch),
      missingDb,
      env,
      'generation-only',
    );

    await expect(controllerForBoot.onModuleInit()).rejects.toThrow(
      'INTEGRATION_CREDENTIAL_WRITERS=generation-only requires migration 0015',
    );
  });

  it('classifies a missing credential column as migration 0015 required', async () => {
    const missingColumn = Object.assign(new Error('column credential_generation does not exist'), {
      code: '42703',
    });
    const missingDb = {
      dialect: 'sqlite',
      get: vi.fn().mockResolvedValueOnce({ name: '0015_account_integration_credential_generation.sql' }).mockRejectedValueOnce(missingColumn),
    } as unknown as Db;
    const env = makeEnv({ INTEGRATION_CREDENTIAL_WRITERS: 'generation-only' });
    const provider = new LocalAuthProvider(db, {
      NODE_ENV: 'test',
      DEV_LOGIN_EMAIL: undefined,
      AUTH_LOCAL_STRICT: undefined,
      SEED_DEMO_FORM: false,
      ONBOARDING_WIZARD: false,
    });
    const auth = new AuthService(db, provider);
    const controllerForBoot = new IntegrationsController(
      auth,
      new HubspotPropertiesService(env, missingDb, 'generation-only', noopFetch),
      new CalendlyEventTypesService(env, missingDb, 'generation-only', noopFetch),
      missingDb,
      env,
      'generation-only',
    );

    await expect(controllerForBoot.onModuleInit()).rejects.toThrow(
      'INTEGRATION_CREDENTIAL_WRITERS=generation-only requires migration 0015',
    );
  });

  it('preserves unrelated startup failures instead of masking them as migration errors', async () => {
    const permissionError = Object.assign(new Error('permission denied for relation _migrations'), {
      code: '42501',
    });
    const failingDb = {
      dialect: 'sqlite',
      get: async () => {
        throw permissionError;
      },
    } as unknown as Db;
    const env = makeEnv({ INTEGRATION_CREDENTIAL_WRITERS: 'generation-only' });
    const provider = new LocalAuthProvider(db, {
      NODE_ENV: 'test',
      DEV_LOGIN_EMAIL: undefined,
      AUTH_LOCAL_STRICT: undefined,
      SEED_DEMO_FORM: false,
      ONBOARDING_WIZARD: false,
    });
    const auth = new AuthService(db, provider);
    const controllerForBoot = new IntegrationsController(
      auth,
      new HubspotPropertiesService(env, failingDb, 'generation-only', noopFetch),
      new CalendlyEventTypesService(env, failingDb, 'generation-only', noopFetch),
      failingDb,
      env,
      'generation-only',
    );

    await expect(controllerForBoot.onModuleInit()).rejects.toBe(permissionError);
  });

  it('probes migration 0015 and logs generation-only at startup', async () => {
    const env = makeEnv({ INTEGRATION_CREDENTIAL_WRITERS: 'generation-only' });
    const built = createController(env, noopFetch);
    const log = vi.spyOn(Logger.prototype, 'log');

    await expect(built.controller.onModuleInit()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      'integration credential writers=generation-only attestation=accepted id=chg-1234',
    );
  });
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
      makeEnv({
        HUBSPOT_PRIVATE_APP_TOKEN: 'env-fallback-token',
        INTEGRATION_CREDENTIAL_WRITERS: 'mixed',
      }),
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

  it('misses cached metadata when the connected token rotates within the five-minute TTL', async () => {
    const initialToken = 'hubspot-cache-initial-0001';
    const rotatedToken = 'hubspot-cache-rotated-0002';
    const expectedAuthorizations = [
      `Bearer ${initialToken}`,
      `Bearer ${initialToken}`,
      `Bearer ${rotatedToken}`,
      `Bearer ${rotatedToken}`,
    ];
    let requests = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const request = requests++;
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (url !== HUBSPOT_PROPERTIES_URL || authorization !== expectedAuthorizations[request]) {
        throw new Error('unexpected HubSpot request');
      }
      const name = request < 2 ? 'initial_property' : 'rotated_property';
      return jsonResponse({ results: [{ name, label: name, type: 'string' }] });
    }) as unknown as typeof fetch;
    const { hubspot } = build(makeEnv(), fetchImpl);
    const id = await accountId();

    await controller.connect(asOwner(), 'hubspot', { token: initialToken });
    const first = await hubspot.listProperties(id, 1_000);
    const unchanged = await hubspot.listProperties(id, 1_001);

    await controller.connect(asOwner(), 'hubspot', { token: rotatedToken });
    const rotated = await hubspot.listProperties(id, 1_002);

    expect(first).toMatchObject({ enabled: true, cached: false, properties: [{ name: 'initial_property' }] });
    expect(unchanged).toMatchObject({ enabled: true, cached: true, properties: [{ name: 'initial_property' }] });
    expect(rotated).toMatchObject({ enabled: true, cached: false, properties: [{ name: 'rotated_property' }] });
    expect(requests).toBe(expectedAuthorizations.length);
  });

  it('does not let a pre-reconnect fetch repopulate cache across service instances', async () => {
    const initialToken = 'hubspot-overlap-initial-0001';
    const rotatedToken = 'hubspot-overlap-rotated-0002';
    const oldFetchStarted = deferred<void>();
    const oldFetch = deferred<Response>();
    const aAuthorizations: string[] = [];
    const fetchA = (async (url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (url !== HUBSPOT_PROPERTIES_URL) throw new Error('unexpected HubSpot URL');
      aAuthorizations.push(authorization ?? '');
      if (authorization === `Bearer ${initialToken}`) {
        oldFetchStarted.resolve();
        return oldFetch.promise;
      }
      if (authorization === `Bearer ${rotatedToken}`) {
        return jsonResponse({ results: [{ name: 'rotated_property', label: 'Rotated property', type: 'string' }] });
      }
      throw new Error('unexpected HubSpot authorization');
    }) as unknown as typeof fetch;
    const bAuthorizations: string[] = [];
    const fetchB = (async (url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (url !== HUBSPOT_PROPERTIES_URL) throw new Error('unexpected HubSpot URL');
      bAuthorizations.push(authorization ?? '');
      if (authorization !== `Bearer ${initialToken}` && authorization !== `Bearer ${rotatedToken}`) {
        throw new Error('unexpected HubSpot authorization');
      }
      return jsonResponse({ results: [] });
    }) as unknown as typeof fetch;
    const { hubspot: serviceB } = build(makeEnv(), fetchB);
    const serviceA = new HubspotPropertiesService(makeEnv(), db, 'generation-only', fetchA);
    const id = await accountId();

    await controller.connect(asOwner(), 'hubspot', { token: initialToken });
    const pending = serviceA.listProperties(id, 1_000);
    await oldFetchStarted.promise;
    await controller.connect(asOwner(), 'hubspot', { token: rotatedToken });
    oldFetch.resolve(
      jsonResponse({ results: [{ name: 'initial_property', label: 'Initial property', type: 'string' }] }),
    );

    const stale = await pending;
    const current = await serviceA.listProperties(id, 1_001);
    const hit = await serviceA.listProperties(id, 1_002);

    expect(serviceA).not.toBe(serviceB);
    expect(stale).toMatchObject({ enabled: true, cached: false, properties: [{ name: 'initial_property' }] });
    expect(current).toMatchObject({ enabled: true, cached: false, properties: [{ name: 'rotated_property' }] });
    expect(hit).toMatchObject({ enabled: true, cached: true, properties: [{ name: 'rotated_property' }] });
    expect(aAuthorizations).toEqual([`Bearer ${initialToken}`, `Bearer ${rotatedToken}`]);
    expect(bAuthorizations).toEqual([`Bearer ${initialToken}`, `Bearer ${rotatedToken}`]);
  });

  it('keeps the final concurrent HubSpot connect winner after a held R0 fetch', async () => {
    const r0Token = 'hubspot-r0-0001';
    const writerAToken = 'hubspot-writer-a-0002';
    const writerBToken = 'hubspot-writer-b-0003';
    const r0FetchStarted = deferred<void>();
    const r0Fetch = deferred<Response>();
    const readerAuthorizations: string[] = [];
    const readerFetch = (async (url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (url !== HUBSPOT_PROPERTIES_URL) throw new Error('unexpected HubSpot URL');
      readerAuthorizations.push(authorization ?? '');
      if (authorization === `Bearer ${r0Token}`) {
        r0FetchStarted.resolve();
        return r0Fetch.promise;
      }
      if (authorization === `Bearer ${writerBToken}`) {
        return jsonResponse({ results: [{ name: 'writer_b', label: 'Writer B', type: 'string' }] });
      }
      throw new Error('unexpected HubSpot authorization');
    }) as unknown as typeof fetch;
    const writerAStarted = deferred<void>();
    const writerAResponse = deferred<Response>();
    const writerAAuthorizations: string[] = [];
    const writerAFetch = (async (url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (url !== HUBSPOT_PROPERTIES_URL || authorization !== `Bearer ${writerAToken}`) {
        throw new Error('unexpected HubSpot writer A request');
      }
      writerAAuthorizations.push(authorization);
      writerAStarted.resolve();
      return writerAResponse.promise;
    }) as unknown as typeof fetch;
    const writerBStarted = deferred<void>();
    const writerBResponse = deferred<Response>();
    const writerBAuthorizations: string[] = [];
    const writerBFetch = (async (url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (url !== HUBSPOT_PROPERTIES_URL || authorization !== `Bearer ${writerBToken}`) {
        throw new Error('unexpected HubSpot writer B request');
      }
      writerBAuthorizations.push(authorization);
      writerBStarted.resolve();
      return writerBResponse.promise;
    }) as unknown as typeof fetch;
    const cacheWrite = vi.spyOn(AccountMetadataCache.prototype, 'setIfCurrent');
    const reader = new HubspotPropertiesService(makeEnv(), db, 'generation-only', readerFetch);
    const controllerA = createController(makeEnv(), writerAFetch).controller;
    const controllerB = createController(makeEnv(), writerBFetch).controller;
    const id = await accountId();

    await upsertIntegration(db, id, 'hubspot', r0Token, ENCRYPTION_KEY);
    const pending = reader.listProperties(id, 1_000);
    await r0FetchStarted.promise;
    // Both connects start from R0; resolving B last makes it the durable winner.
    const connectA = controllerA.connect(asOwner(), 'hubspot', { token: writerAToken });
    const connectB = controllerB.connect(asOwner(), 'hubspot', { token: writerBToken });
    await Promise.all([writerAStarted.promise, writerBStarted.promise]);
    writerAResponse.resolve(jsonResponse({ results: [] }));
    await connectA;
    writerBResponse.resolve(jsonResponse({ results: [] }));
    await connectB;
    const winner = await resolveProviderToken(db, id, 'hubspot', ENCRYPTION_KEY, undefined);
    r0Fetch.resolve(jsonResponse({ results: [{ name: 'r0', label: 'R0', type: 'string' }] }));

    const stale = await pending;
    const current = await reader.listProperties(id, 1_001);
    const hit = await reader.listProperties(id, 1_002);

    expect(stale).toMatchObject({ enabled: true, cached: false, properties: [{ name: 'r0' }] });
    expect(winner).toMatchObject({ token: writerBToken, revision: { kind: 'stored' } });
    expect(current).toMatchObject({ enabled: true, cached: false, properties: [{ name: 'writer_b' }] });
    expect(hit).toMatchObject({ enabled: true, cached: true, properties: [{ name: 'writer_b' }] });
    expect(cacheWrite).toHaveReturnedWith(false);
    expect(readerAuthorizations).toEqual([`Bearer ${r0Token}`, `Bearer ${writerBToken}`]);
    expect(writerAAuthorizations).toEqual([`Bearer ${writerAToken}`]);
    expect(writerBAuthorizations).toEqual([`Bearer ${writerBToken}`]);
  });

  it('does not cache held HubSpot metadata through equal-time old-writer updates in mixed mode', async () => {
    const r0Token = 'r0';
    const oldWriterAToken = 'old-a';
    const oldWriterBToken = 'old-b';
    const r0FetchStarted = deferred<void>();
    const r0Fetch = deferred<Response>();
    const authorizations: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (url !== HUBSPOT_PROPERTIES_URL) throw new Error('unexpected HubSpot URL');
      authorizations.push(authorization ?? '');
      if (authorization === `Bearer ${r0Token}`) {
        r0FetchStarted.resolve();
        return r0Fetch.promise;
      }
      if (authorization === `Bearer ${oldWriterBToken}`) {
        return jsonResponse({ results: [{ name: 'writer_b', label: 'Writer B', type: 'string' }] });
      }
      throw new Error('unexpected HubSpot authorization');
    }) as unknown as typeof fetch;
    const cacheWrite = vi.spyOn(AccountMetadataCache.prototype, 'setIfCurrent');
    const reader = new HubspotPropertiesService(makeEnv({ INTEGRATION_CREDENTIAL_WRITERS: 'mixed' }), db, 'mixed', fetchImpl);
    const id = await accountId();

    await upsertIntegration(db, id, 'hubspot', r0Token, ENCRYPTION_KEY);
    const before = await getIntegration(db, id, 'hubspot');
    const pending = reader.listProperties(id, 1_000);
    await r0FetchStarted.promise;
    const oldWriterUpdatedAt = before!.updatedAt + 1;
    for (const token of [oldWriterAToken, oldWriterBToken]) {
      await db.run(
        sql`UPDATE account_integration
            SET encrypted_token = ${encryptToken(token, ENCRYPTION_KEY)},
                meta = ${jsonParam({ last4: token.slice(-4) })},
                updated_at = ${oldWriterUpdatedAt}
            WHERE account_id = ${id} AND provider = ${'hubspot'}`,
      );
    }
    r0Fetch.resolve(jsonResponse({ results: [{ name: 'r0', label: 'R0', type: 'string' }] }));

    const stale = await pending;
    const current = await reader.listProperties(id, 1_001);
    const after = await getIntegration(db, id, 'hubspot');
    const winner = await resolveProviderToken(db, id, 'hubspot', ENCRYPTION_KEY, undefined);

    expect(stale).toMatchObject({ enabled: true, cached: false, properties: [{ name: 'r0' }] });
    expect(current).toMatchObject({ enabled: true, cached: false, properties: [{ name: 'writer_b' }] });
    expect(cacheWrite).toHaveReturnedWith(false);
    expect(after!.credentialGeneration).toBe(before!.credentialGeneration);
    expect(after!.updatedAt).toBe(oldWriterUpdatedAt);
    expect(winner).toMatchObject({ token: oldWriterBToken });
    expect(authorizations).toEqual([`Bearer ${r0Token}`, `Bearer ${oldWriterBToken}`]);
  });

  it('safety counterfactual: generation-only stale-serves held HubSpot R0 after equal-time old writers', async () => {
    const r0Token = 'r0';
    const oldWriterAToken = 'old-a';
    const oldWriterBToken = 'old-b';
    const r0FetchStarted = deferred<void>();
    const r0Fetch = deferred<Response>();
    const authorizations: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (url !== HUBSPOT_PROPERTIES_URL || authorization !== `Bearer ${r0Token}`) {
        throw new Error('unexpected HubSpot request');
      }
      authorizations.push(authorization);
      r0FetchStarted.resolve();
      return r0Fetch.promise;
    }) as unknown as typeof fetch;
    const cacheWrite = vi.spyOn(AccountMetadataCache.prototype, 'setIfCurrent');
    const reader = new HubspotPropertiesService(
      makeEnv({ INTEGRATION_CREDENTIAL_WRITERS: 'generation-only' }),
      db,
      'generation-only',
      fetchImpl,
    );
    const id = await accountId();

    await upsertIntegration(db, id, 'hubspot', r0Token, ENCRYPTION_KEY);
    const before = await getIntegration(db, id, 'hubspot');
    const pending = reader.listProperties(id, 1_000);
    await r0FetchStarted.promise;
    const oldWriterUpdatedAt = before!.updatedAt + 1;
    for (const token of [oldWriterAToken, oldWriterBToken]) {
      await db.run(
        sql`UPDATE account_integration
            SET encrypted_token = ${encryptToken(token, ENCRYPTION_KEY)},
                meta = ${jsonParam({ last4: token.slice(-4) })},
                updated_at = ${oldWriterUpdatedAt}
            WHERE account_id = ${id} AND provider = ${'hubspot'}`,
      );
    }
    r0Fetch.resolve(jsonResponse({ results: [{ name: 'r0', label: 'R0', type: 'string' }] }));

    const stale = await pending;
    const later = await reader.listProperties(id, 1_001);

    expect(stale).toMatchObject({ enabled: true, cached: false, properties: [{ name: 'r0' }] });
    expect(later).toMatchObject({ enabled: true, cached: true, properties: [{ name: 'r0' }] });
    expect(cacheWrite).toHaveReturnedWith(true);
    expect(authorizations).toEqual([`Bearer ${r0Token}`]);
  });

  it('misses cached HubSpot metadata after a peer advances generation N to N+1', async () => {
    const initialToken = 'first';
    const nextToken = 'second';
    const readerAuthorizations: string[] = [];
    const readerFetch = (async (url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (url !== HUBSPOT_PROPERTIES_URL) throw new Error('unexpected HubSpot URL');
      readerAuthorizations.push(authorization ?? '');
      if (authorization === `Bearer ${initialToken}`) {
        return jsonResponse({ results: [{ name: 'generation_n', label: 'Generation N', type: 'string' }] });
      }
      if (authorization === `Bearer ${nextToken}`) {
        return jsonResponse({ results: [{ name: 'generation_n_plus_1', label: 'Generation N+1', type: 'string' }] });
      }
      throw new Error('unexpected HubSpot authorization');
    }) as unknown as typeof fetch;
    const peerAuthorizations: string[] = [];
    const peerFetch = (async (url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (url !== HUBSPOT_PROPERTIES_URL || authorization !== `Bearer ${nextToken}`) {
        throw new Error('unexpected HubSpot peer request');
      }
      peerAuthorizations.push(authorization);
      return jsonResponse({ results: [] });
    }) as unknown as typeof fetch;
    const reader = new HubspotPropertiesService(makeEnv(), db, 'generation-only', readerFetch);
    const peer = createController(makeEnv(), peerFetch);
    const id = await accountId();

    await upsertIntegration(db, id, 'hubspot', initialToken, ENCRYPTION_KEY);
    const first = await reader.listProperties(id, 1_000);
    const before = await resolveProviderToken(db, id, 'hubspot', ENCRYPTION_KEY, undefined);
    await peer.controller.connect(asOwner(), 'hubspot', { token: nextToken });
    const after = await resolveProviderToken(db, id, 'hubspot', ENCRYPTION_KEY, undefined);
    const current = await reader.listProperties(id, 1_001);
    const hit = await reader.listProperties(id, 1_002);
    if (!before || before.revision.kind !== 'stored') throw new Error('expected stored pre-write revision');
    if (!after || after.revision.kind !== 'stored') throw new Error('expected stored post-write revision');

    expect(reader).not.toBe(peer.hubspot);
    expect(first).toMatchObject({ enabled: true, cached: false, properties: [{ name: 'generation_n' }] });
    expect(after.revision.generation).toBe(before.revision.generation + 1);
    expect(current).toMatchObject({
      enabled: true,
      cached: false,
      properties: [{ name: 'generation_n_plus_1' }],
    });
    expect(hit).toMatchObject({ enabled: true, cached: true, properties: [{ name: 'generation_n_plus_1' }] });
    expect(readerAuthorizations).toEqual([`Bearer ${initialToken}`, `Bearer ${nextToken}`]);
    expect(peerAuthorizations).toEqual([`Bearer ${nextToken}`]);
  });

  it('misses an uninformed HubSpot cache through disconnect, env fallback, and reconnect', async () => {
    const initialToken = 'hubspot-pre-disconnect-0001';
    const fallbackToken = 'hubspot-fallback-0002';
    const reconnectToken = 'hubspot-reconnect-0003';
    const readerAuthorizations: string[] = [];
    const readerFetch = (async (url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (url !== HUBSPOT_PROPERTIES_URL) throw new Error('unexpected HubSpot URL');
      readerAuthorizations.push(authorization ?? '');
      const name =
        authorization === `Bearer ${initialToken}`
          ? 'initial'
          : authorization === `Bearer ${fallbackToken}`
            ? 'fallback'
            : authorization === `Bearer ${reconnectToken}`
              ? 'reconnect'
              : null;
      if (!name) throw new Error('unexpected HubSpot authorization');
      return jsonResponse({ results: [{ name, label: name, type: 'string' }] });
    }) as unknown as typeof fetch;
    const peerAuthorizations: string[] = [];
    const peerFetch = (async (url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (url !== HUBSPOT_PROPERTIES_URL || authorization !== `Bearer ${reconnectToken}`) {
        throw new Error('unexpected HubSpot peer request');
      }
      peerAuthorizations.push(authorization);
      return jsonResponse({ results: [] });
    }) as unknown as typeof fetch;
    const env = makeEnv({ HUBSPOT_PRIVATE_APP_TOKEN: fallbackToken });
    const reader = new HubspotPropertiesService(env, db, env.INTEGRATION_CREDENTIAL_WRITERS, readerFetch);
    const peer = createController(env, peerFetch);
    const id = await accountId();

    await upsertIntegration(db, id, 'hubspot', initialToken, ENCRYPTION_KEY);
    const before = await resolveProviderToken(db, id, 'hubspot', ENCRYPTION_KEY, fallbackToken);
    const initial = await reader.listProperties(id, 1_000);
    await peer.controller.disconnect(asOwner(), 'hubspot');
    const fallback = await reader.listProperties(id, 1_001);
    await peer.controller.connect(asOwner(), 'hubspot', { token: reconnectToken });
    const after = await resolveProviderToken(db, id, 'hubspot', ENCRYPTION_KEY, fallbackToken);
    const reconnected = await reader.listProperties(id, 1_002);
    if (!before || before.revision.kind !== 'stored') throw new Error('expected stored pre-disconnect revision');
    if (!after || after.revision.kind !== 'stored') throw new Error('expected stored reconnect revision');

    expect(after.revision.generation).toBe(1);
    expect(after.revision.id).not.toBe(before.revision.id);
    expect(initial).toMatchObject({ enabled: true, cached: false, properties: [{ name: 'initial' }] });
    expect(fallback).toMatchObject({ enabled: true, cached: false, properties: [{ name: 'fallback' }] });
    expect(reconnected).toMatchObject({ enabled: true, cached: false, properties: [{ name: 'reconnect' }] });
    expect(readerAuthorizations).toEqual([
      `Bearer ${initialToken}`,
      `Bearer ${fallbackToken}`,
      `Bearer ${reconnectToken}`,
    ]);
    expect(peerAuthorizations).toEqual([`Bearer ${reconnectToken}`]);
  });

  it('keeps mixed safe and labels generation-only old-writer stale serving as a safety counterfactual', async () => {
    const initialToken = 'old-a';
    const replacementToken = 'old-b';
    const fetchFor = (authorizations: string[]): typeof fetch =>
      (async (url: string, init?: RequestInit) => {
        const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
        if (url !== HUBSPOT_PROPERTIES_URL) throw new Error('unexpected HubSpot URL');
        authorizations.push(authorization ?? '');
        const name =
          authorization === `Bearer ${initialToken}`
            ? 'initial'
            : authorization === `Bearer ${replacementToken}`
              ? 'replacement'
              : null;
        if (!name) throw new Error('unexpected HubSpot authorization');
        return jsonResponse({ results: [{ name, label: name, type: 'string' }] });
      }) as unknown as typeof fetch;
    const id = await accountId();

    const oldWriterUpdate = async (): Promise<void> => {
      const row = await getIntegration(db, id, 'hubspot');
      await db.run(
        sql`UPDATE account_integration
            SET encrypted_token = ${encryptToken(replacementToken, ENCRYPTION_KEY)},
                meta = ${jsonParam({ last4: 'ld-b' })},
                updated_at = ${row!.updatedAt + 1}
            WHERE account_id = ${id} AND provider = ${'hubspot'}`,
      );
    };

    await upsertIntegration(db, id, 'hubspot', initialToken, ENCRYPTION_KEY);
    const mixedAuthorizations: string[] = [];
    const mixed = new HubspotPropertiesService(makeEnv({ INTEGRATION_CREDENTIAL_WRITERS: 'mixed' }), db, 'mixed', fetchFor(mixedAuthorizations));
    const mixedFirst = await mixed.listProperties(id, 1_000);
    const mixedBefore = await getIntegration(db, id, 'hubspot');
    await oldWriterUpdate();
    const mixedCurrent = await mixed.listProperties(id, 1_001);
    const mixedAfter = await getIntegration(db, id, 'hubspot');

    expect(mixedFirst).toMatchObject({ enabled: true, cached: false, properties: [{ name: 'initial' }] });
    expect(mixedCurrent).toMatchObject({ enabled: true, cached: false, properties: [{ name: 'replacement' }] });
    expect(mixedAfter!.credentialGeneration).toBe(mixedBefore!.credentialGeneration);
    expect(mixedAuthorizations).toEqual([`Bearer ${initialToken}`, `Bearer ${replacementToken}`]);

    await upsertIntegration(db, id, 'hubspot', initialToken, ENCRYPTION_KEY);
    const generationOnlyAuthorizations: string[] = [];
    const generationOnly = new HubspotPropertiesService(
      makeEnv({ INTEGRATION_CREDENTIAL_WRITERS: 'generation-only' }),
      db,
      'generation-only',
      fetchFor(generationOnlyAuthorizations),
    );
    const unsafeFirst = await generationOnly.listProperties(id, 1_002);
    await oldWriterUpdate();
    // Safety counterfactual only: an old writer while generation-only is live
    // leaves its generation unchanged, so this intentionally stale-serves A.
    const unsafeSecond = await generationOnly.listProperties(id, 1_003);

    expect(unsafeFirst).toMatchObject({ enabled: true, cached: false, properties: [{ name: 'initial' }] });
    expect(unsafeSecond).toMatchObject({ enabled: true, cached: true, properties: [{ name: 'initial' }] });
    expect(generationOnlyAuthorizations).toEqual([`Bearer ${initialToken}`]);
  });

  it('invalidates cached metadata when the account switches to and from an env fallback', async () => {
    const fallbackToken = 'hubspot-fallback-0001';
    const accountToken = 'hubspot-account-0002';
    const expectedAuthorizations = [
      `Bearer ${fallbackToken}`,
      `Bearer ${accountToken}`,
      `Bearer ${accountToken}`,
      `Bearer ${fallbackToken}`,
    ];
    let requests = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const request = requests++;
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (url !== HUBSPOT_PROPERTIES_URL || authorization !== expectedAuthorizations[request]) {
        throw new Error('unexpected HubSpot request');
      }
      const name = request === 0 || request === 3 ? 'fallback_property' : 'account_property';
      return jsonResponse({ results: [{ name, label: name, type: 'string' }] });
    }) as unknown as typeof fetch;
    const { hubspot } = build(makeEnv({ HUBSPOT_PRIVATE_APP_TOKEN: fallbackToken }), fetchImpl);
    const id = await accountId();

    const fallback = await hubspot.listProperties(id, 1_000);
    await controller.connect(asOwner(), 'hubspot', { token: accountToken });
    const connected = await hubspot.listProperties(id, 1_001);
    await controller.disconnect(asOwner(), 'hubspot');
    const returnedToFallback = await hubspot.listProperties(id, 1_002);

    expect(fallback).toMatchObject({ enabled: true, cached: false, properties: [{ name: 'fallback_property' }] });
    expect(connected).toMatchObject({ enabled: true, cached: false, properties: [{ name: 'account_property' }] });
    expect(returnedToFallback).toMatchObject({
      enabled: true,
      cached: false,
      properties: [{ name: 'fallback_property' }],
    });
    expect(requests).toBe(expectedAuthorizations.length);
  });

  it('keeps shared-token cached metadata isolated by account', async () => {
    const fallbackToken = 'shared-hubspot-fallback-token';
    let requests = 0;
    const { hubspot } = build(
      makeEnv({ HUBSPOT_PRIVATE_APP_TOKEN: fallbackToken }),
      (async (url: string, init?: RequestInit) => {
        const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
        if (url !== HUBSPOT_PROPERTIES_URL || authorization !== `Bearer ${fallbackToken}`) {
          throw new Error('unexpected HubSpot request');
        }
        requests += 1;
        const name = requests === 1 ? 'first_account_property' : 'second_account_property';
        return jsonResponse({ results: [{ name, label: name, type: 'string' }] });
      }) as unknown as typeof fetch,
    );

    const first = await hubspot.listProperties('first-account', 1_000);
    const second = await hubspot.listProperties('second-account', 1_001);

    expect(first).toMatchObject({ enabled: true, cached: false, properties: [{ name: 'first_account_property' }] });
    expect(second).toMatchObject({ enabled: true, cached: false, properties: [{ name: 'second_account_property' }] });
    expect(requests).toBe(2);
  });
});

describe('Calendly event-type picker token resolution', () => {
  const CALENDLY_EVENT_TYPES_BASE = 'https://api.calendly.com/event_types';
  const CONNECTED_TOKEN = 'cal-account-8888';
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

  /** Answers /users/me exactly and /event_types by prefix, rejecting unexpected authorization. */
  function calendlyFetch(
    calls: RecordedCall[],
    me: unknown,
    list: unknown,
    expectedAuthorization: string,
  ): typeof fetch {
    return (async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers.authorization !== expectedAuthorization) {
        throw new Error('unexpected Calendly authorization');
      }
      calls.push({ url, headers });
      if (url === CALENDLY_ME_URL) return jsonResponse(me);
      if (url.startsWith(CALENDLY_EVENT_TYPES_BASE)) return jsonResponse(list);
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
  }

  it('uses the CONNECTED account token, scopes to its user, and returns sorted event types', async () => {
    const calls: RecordedCall[] = [];
    build(makeEnv(), calendlyFetch(calls, ME, EVENT_TYPES, `Bearer ${CONNECTED_TOKEN}`));
    await controller.connect(asOwner(), 'calendly', { token: CONNECTED_TOKEN });

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
    expect(calls.every((c) => c.headers.authorization === `Bearer ${CONNECTED_TOKEN}`)).toBe(true);
    expect(
      calls.some((c) => c.url.includes(`user=${encodeURIComponent(ME.resource.uri)}`)),
    ).toBe(true);
  });

  it('exposes each event type’s own custom questions by their POSITIONAL id', async () => {
    const calls: RecordedCall[] = [];
    build(makeEnv(), calendlyFetch(calls, ME, EVENT_TYPES, `Bearer ${CONNECTED_TOKEN}`));
    await controller.connect(asOwner(), 'calendly', { token: CONNECTED_TOKEN });

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

  it('caches Calendly env-fallback metadata in mixed mode', async () => {
    const fallbackToken = 'fallback';
    let requests = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (authorization !== `Bearer ${fallbackToken}`) throw new Error('unexpected Calendly authorization');
      requests += 1;
      if (url === CALENDLY_ME_URL) {
        return jsonResponse({ resource: { uri: 'https://api.calendly.com/users/fallback' } });
      }
      if (url.startsWith(CALENDLY_EVENT_TYPES_BASE)) {
        return jsonResponse({
          collection: [
            {
              uri: 'https://api.calendly.com/event_types/fallback',
              name: 'fallback event',
              scheduling_url: 'https://calendly.com/acme/fallback',
            },
          ],
        });
      }
      throw new Error('unexpected Calendly URL');
    }) as unknown as typeof fetch;
    const { calendly } = build(
      makeEnv({
        CALENDLY_API_TOKEN: fallbackToken,
        INTEGRATION_CREDENTIAL_WRITERS: 'mixed',
      }),
      fetchImpl,
    );
    const id = await accountId();

    const first = await calendly.listEventTypes(id, 1_000);
    const second = await calendly.listEventTypes(id, 1_001);

    expect(first).toMatchObject({ enabled: true, cached: false, eventTypes: [{ name: 'fallback event' }] });
    expect(second).toMatchObject({ enabled: true, cached: true, eventTypes: [{ name: 'fallback event' }] });
    expect(requests).toBe(2);
  });

  it('misses cached metadata when the connected token rotates within the five-minute TTL', async () => {
    const initialToken = 'calendly-cache-initial-0001';
    const rotatedToken = 'calendly-cache-rotated-0002';
    const expectedAuthorizations = [
      `Bearer ${initialToken}`,
      `Bearer ${initialToken}`,
      `Bearer ${initialToken}`,
      `Bearer ${rotatedToken}`,
      `Bearer ${rotatedToken}`,
      `Bearer ${rotatedToken}`,
    ];
    let requests = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const request = requests++;
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (authorization !== expectedAuthorizations[request]) {
        throw new Error('unexpected Calendly authorization');
      }
      const expectsMe = request === 0 || request === 1 || request === 3 || request === 4;
      if ((expectsMe && url !== CALENDLY_ME_URL) || (!expectsMe && !url.startsWith(CALENDLY_EVENT_TYPES_BASE))) {
        throw new Error('unexpected Calendly request');
      }
      const suffix = request < 3 ? 'initial' : 'rotated';
      if (url === CALENDLY_ME_URL) {
        return jsonResponse({ resource: { uri: `https://api.calendly.com/users/${suffix}` } });
      }
      if (url.startsWith(CALENDLY_EVENT_TYPES_BASE)) {
        return jsonResponse({
          collection: [
            {
              uri: `https://api.calendly.com/event_types/${suffix}`,
              name: `${suffix} event`,
              scheduling_url: `https://calendly.com/acme/${suffix}`,
            },
          ],
        });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    const { calendly } = build(makeEnv(), fetchImpl);
    const id = await accountId();

    await controller.connect(asOwner(), 'calendly', { token: initialToken });
    const first = await calendly.listEventTypes(id, 1_000);
    const unchanged = await calendly.listEventTypes(id, 1_001);

    await controller.connect(asOwner(), 'calendly', { token: rotatedToken });
    const rotated = await calendly.listEventTypes(id, 1_002);

    expect(first).toMatchObject({ enabled: true, cached: false, eventTypes: [{ name: 'initial event' }] });
    expect(unchanged).toMatchObject({ enabled: true, cached: true, eventTypes: [{ name: 'initial event' }] });
    expect(rotated).toMatchObject({ enabled: true, cached: false, eventTypes: [{ name: 'rotated event' }] });
    expect(requests).toBe(expectedAuthorizations.length);
  });

  it('keeps the final concurrent Calendly connect winner after a held R0 fetch', async () => {
    const r0Token = 'calendly-r0-0001';
    const writerAToken = 'calendly-writer-a-0002';
    const writerBToken = 'calendly-writer-b-0003';
    const r0MeStarted = deferred<void>();
    const r0Me = deferred<Response>();
    const readerAuthorizations: string[] = [];
    const readerFetch = (async (url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      readerAuthorizations.push(authorization ?? '');
      if (authorization === `Bearer ${r0Token}`) {
        if (url === CALENDLY_ME_URL) {
          r0MeStarted.resolve();
          return r0Me.promise;
        }
        if (url.startsWith(CALENDLY_EVENT_TYPES_BASE)) {
          return jsonResponse({
            collection: [
              {
                uri: 'https://api.calendly.com/event_types/r0',
                name: 'r0 event',
                scheduling_url: 'https://calendly.com/acme/r0',
              },
            ],
          });
        }
      }
      if (authorization === `Bearer ${writerBToken}`) {
        if (url === CALENDLY_ME_URL) {
          return jsonResponse({ resource: { uri: 'https://api.calendly.com/users/writer-b' } });
        }
        if (url.startsWith(CALENDLY_EVENT_TYPES_BASE)) {
          return jsonResponse({
            collection: [
              {
                uri: 'https://api.calendly.com/event_types/writer-b',
                name: 'writer b event',
                scheduling_url: 'https://calendly.com/acme/writer-b',
              },
            ],
          });
        }
      }
      throw new Error('unexpected Calendly reader request');
    }) as unknown as typeof fetch;
    const writerAStarted = deferred<void>();
    const writerAResponse = deferred<Response>();
    const writerAAuthorizations: string[] = [];
    const writerAFetch = (async (url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (url !== CALENDLY_ME_URL || authorization !== `Bearer ${writerAToken}`) {
        throw new Error('unexpected Calendly writer A request');
      }
      writerAAuthorizations.push(authorization);
      writerAStarted.resolve();
      return writerAResponse.promise;
    }) as unknown as typeof fetch;
    const writerBStarted = deferred<void>();
    const writerBResponse = deferred<Response>();
    const writerBAuthorizations: string[] = [];
    const writerBFetch = (async (url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (url !== CALENDLY_ME_URL || authorization !== `Bearer ${writerBToken}`) {
        throw new Error('unexpected Calendly writer B request');
      }
      writerBAuthorizations.push(authorization);
      writerBStarted.resolve();
      return writerBResponse.promise;
    }) as unknown as typeof fetch;
    const cacheWrite = vi.spyOn(AccountMetadataCache.prototype, 'setIfCurrent');
    const reader = new CalendlyEventTypesService(makeEnv(), db, 'generation-only', readerFetch);
    const controllerA = createController(makeEnv(), writerAFetch).controller;
    const controllerB = createController(makeEnv(), writerBFetch).controller;
    const id = await accountId();

    await upsertIntegration(db, id, 'calendly', r0Token, ENCRYPTION_KEY);
    const pending = reader.listEventTypes(id, 1_000);
    await r0MeStarted.promise;
    // Both connects start from R0; resolving B last makes it the durable winner.
    const connectA = controllerA.connect(asOwner(), 'calendly', { token: writerAToken });
    const connectB = controllerB.connect(asOwner(), 'calendly', { token: writerBToken });
    await Promise.all([writerAStarted.promise, writerBStarted.promise]);
    writerAResponse.resolve(jsonResponse({ resource: { uri: 'https://api.calendly.com/users/writer-a' } }));
    await connectA;
    writerBResponse.resolve(jsonResponse({ resource: { uri: 'https://api.calendly.com/users/writer-b' } }));
    await connectB;
    const winner = await resolveProviderToken(db, id, 'calendly', ENCRYPTION_KEY, undefined);
    r0Me.resolve(jsonResponse({ resource: { uri: 'https://api.calendly.com/users/r0' } }));

    const stale = await pending;
    const current = await reader.listEventTypes(id, 1_001);
    const hit = await reader.listEventTypes(id, 1_002);

    expect(stale).toMatchObject({ enabled: true, cached: false, eventTypes: [{ name: 'r0 event' }] });
    expect(winner).toMatchObject({ token: writerBToken, revision: { kind: 'stored' } });
    expect(current).toMatchObject({ enabled: true, cached: false, eventTypes: [{ name: 'writer b event' }] });
    expect(hit).toMatchObject({ enabled: true, cached: true, eventTypes: [{ name: 'writer b event' }] });
    expect(cacheWrite).toHaveReturnedWith(false);
    expect(readerAuthorizations).toEqual([
      `Bearer ${r0Token}`,
      `Bearer ${r0Token}`,
      `Bearer ${writerBToken}`,
      `Bearer ${writerBToken}`,
    ]);
    expect(writerAAuthorizations).toEqual([`Bearer ${writerAToken}`]);
    expect(writerBAuthorizations).toEqual([`Bearer ${writerBToken}`]);
  });

  it('does not cache held Calendly metadata through equal-time old-writer updates in mixed mode', async () => {
    const r0Token = 'r0';
    const oldWriterAToken = 'old-a';
    const oldWriterBToken = 'old-b';
    const r0MeStarted = deferred<void>();
    const r0Me = deferred<Response>();
    const authorizations: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      authorizations.push(authorization ?? '');
      if (authorization === `Bearer ${r0Token}`) {
        if (url === CALENDLY_ME_URL) {
          r0MeStarted.resolve();
          return r0Me.promise;
        }
        if (url.startsWith(CALENDLY_EVENT_TYPES_BASE)) {
          return jsonResponse({
            collection: [
              {
                uri: 'https://api.calendly.com/event_types/r0',
                name: 'r0 event',
                scheduling_url: 'https://calendly.com/acme/r0',
              },
            ],
          });
        }
      }
      if (authorization === `Bearer ${oldWriterBToken}`) {
        if (url === CALENDLY_ME_URL) {
          return jsonResponse({ resource: { uri: 'https://api.calendly.com/users/writer-b' } });
        }
        if (url.startsWith(CALENDLY_EVENT_TYPES_BASE)) {
          return jsonResponse({
            collection: [
              {
                uri: 'https://api.calendly.com/event_types/writer-b',
                name: 'writer b event',
                scheduling_url: 'https://calendly.com/acme/writer-b',
              },
            ],
          });
        }
      }
      throw new Error('unexpected Calendly request');
    }) as unknown as typeof fetch;
    const cacheWrite = vi.spyOn(AccountMetadataCache.prototype, 'setIfCurrent');
    const reader = new CalendlyEventTypesService(
      makeEnv({ INTEGRATION_CREDENTIAL_WRITERS: 'mixed' }),
      db,
      'mixed',
      fetchImpl,
    );
    const id = await accountId();

    await upsertIntegration(db, id, 'calendly', r0Token, ENCRYPTION_KEY);
    const before = await getIntegration(db, id, 'calendly');
    const pending = reader.listEventTypes(id, 1_000);
    await r0MeStarted.promise;
    const oldWriterUpdatedAt = before!.updatedAt + 1;
    for (const token of [oldWriterAToken, oldWriterBToken]) {
      await db.run(
        sql`UPDATE account_integration
            SET encrypted_token = ${encryptToken(token, ENCRYPTION_KEY)},
                meta = ${jsonParam({ last4: token.slice(-4) })},
                updated_at = ${oldWriterUpdatedAt}
            WHERE account_id = ${id} AND provider = ${'calendly'}`,
      );
    }
    r0Me.resolve(jsonResponse({ resource: { uri: 'https://api.calendly.com/users/r0' } }));

    const stale = await pending;
    const current = await reader.listEventTypes(id, 1_001);
    const after = await getIntegration(db, id, 'calendly');
    const winner = await resolveProviderToken(db, id, 'calendly', ENCRYPTION_KEY, undefined);

    expect(stale).toMatchObject({ enabled: true, cached: false, eventTypes: [{ name: 'r0 event' }] });
    expect(current).toMatchObject({ enabled: true, cached: false, eventTypes: [{ name: 'writer b event' }] });
    expect(cacheWrite).toHaveReturnedWith(false);
    expect(after!.credentialGeneration).toBe(before!.credentialGeneration);
    expect(after!.updatedAt).toBe(oldWriterUpdatedAt);
    expect(winner).toMatchObject({ token: oldWriterBToken });
    expect(authorizations).toEqual([
      `Bearer ${r0Token}`,
      `Bearer ${r0Token}`,
      `Bearer ${oldWriterBToken}`,
      `Bearer ${oldWriterBToken}`,
    ]);
  });

  it('safety counterfactual: generation-only stale-serves held Calendly R0 after equal-time old writers', async () => {
    const r0Token = 'r0';
    const oldWriterAToken = 'old-a';
    const oldWriterBToken = 'old-b';
    const r0MeStarted = deferred<void>();
    const r0Me = deferred<Response>();
    const authorizations: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (authorization !== `Bearer ${r0Token}`) throw new Error('unexpected Calendly authorization');
      authorizations.push(authorization);
      if (url === CALENDLY_ME_URL) {
        r0MeStarted.resolve();
        return r0Me.promise;
      }
      if (url.startsWith(CALENDLY_EVENT_TYPES_BASE)) {
        return jsonResponse({
          collection: [
            {
              uri: 'https://api.calendly.com/event_types/r0',
              name: 'r0 event',
              scheduling_url: 'https://calendly.com/acme/r0',
            },
          ],
        });
      }
      throw new Error('unexpected Calendly URL');
    }) as unknown as typeof fetch;
    const cacheWrite = vi.spyOn(AccountMetadataCache.prototype, 'setIfCurrent');
    const reader = new CalendlyEventTypesService(
      makeEnv({ INTEGRATION_CREDENTIAL_WRITERS: 'generation-only' }),
      db,
      'generation-only',
      fetchImpl,
    );
    const id = await accountId();

    await upsertIntegration(db, id, 'calendly', r0Token, ENCRYPTION_KEY);
    const before = await getIntegration(db, id, 'calendly');
    const pending = reader.listEventTypes(id, 1_000);
    await r0MeStarted.promise;
    const oldWriterUpdatedAt = before!.updatedAt + 1;
    for (const token of [oldWriterAToken, oldWriterBToken]) {
      await db.run(
        sql`UPDATE account_integration
            SET encrypted_token = ${encryptToken(token, ENCRYPTION_KEY)},
                meta = ${jsonParam({ last4: token.slice(-4) })},
                updated_at = ${oldWriterUpdatedAt}
            WHERE account_id = ${id} AND provider = ${'calendly'}`,
      );
    }
    r0Me.resolve(jsonResponse({ resource: { uri: 'https://api.calendly.com/users/r0' } }));

    const stale = await pending;
    const later = await reader.listEventTypes(id, 1_001);

    expect(stale).toMatchObject({ enabled: true, cached: false, eventTypes: [{ name: 'r0 event' }] });
    expect(later).toMatchObject({ enabled: true, cached: true, eventTypes: [{ name: 'r0 event' }] });
    expect(cacheWrite).toHaveReturnedWith(true);
    expect(authorizations).toEqual([`Bearer ${r0Token}`, `Bearer ${r0Token}`]);
  });

  it('does not let a pre-disconnect fetch repopulate cache across service instances', async () => {
    const accountToken = 'calendly-overlap-account-0001';
    const fallbackToken = 'calendly-overlap-fallback-0002';
    const oldMeStarted = deferred<void>();
    const oldMe = deferred<Response>();
    const aAuthorizations: string[] = [];
    const fetchA = (async (url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      aAuthorizations.push(authorization ?? '');
      if (authorization === `Bearer ${accountToken}`) {
        if (url === CALENDLY_ME_URL) {
          oldMeStarted.resolve();
          return oldMe.promise;
        }
        if (url.startsWith(CALENDLY_EVENT_TYPES_BASE)) {
          return jsonResponse({
            collection: [
              {
                uri: 'https://api.calendly.com/event_types/account',
                name: 'account event',
                scheduling_url: 'https://calendly.com/acme/account',
              },
            ],
          });
        }
      }
      if (authorization === `Bearer ${fallbackToken}`) {
        if (url === CALENDLY_ME_URL) {
          return jsonResponse({ resource: { uri: 'https://api.calendly.com/users/fallback' } });
        }
        if (url.startsWith(CALENDLY_EVENT_TYPES_BASE)) {
          return jsonResponse({
            collection: [
              {
                uri: 'https://api.calendly.com/event_types/fallback',
                name: 'fallback event',
                scheduling_url: 'https://calendly.com/acme/fallback',
              },
            ],
          });
        }
      }
      throw new Error('unexpected Calendly request');
    }) as unknown as typeof fetch;
    const bAuthorizations: string[] = [];
    const fetchB = (async (url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      bAuthorizations.push(authorization ?? '');
      if (url !== CALENDLY_ME_URL || authorization !== `Bearer ${accountToken}`) {
        throw new Error('unexpected Calendly request');
      }
      return jsonResponse({ resource: { uri: 'https://api.calendly.com/users/account' } });
    }) as unknown as typeof fetch;
    const env = makeEnv({ CALENDLY_API_TOKEN: fallbackToken });
    const { calendly: serviceB } = build(env, fetchB);
    const serviceA = new CalendlyEventTypesService(env, db, env.INTEGRATION_CREDENTIAL_WRITERS, fetchA);
    const id = await accountId();

    await controller.connect(asOwner(), 'calendly', { token: accountToken });
    const pending = serviceA.listEventTypes(id, 1_000);
    await oldMeStarted.promise;
    await controller.disconnect(asOwner(), 'calendly');
    oldMe.resolve(jsonResponse({ resource: { uri: 'https://api.calendly.com/users/account' } }));

    const stale = await pending;
    const current = await serviceA.listEventTypes(id, 1_001);
    const hit = await serviceA.listEventTypes(id, 1_002);

    expect(serviceA).not.toBe(serviceB);
    expect(stale).toMatchObject({ enabled: true, cached: false, eventTypes: [{ name: 'account event' }] });
    expect(current).toMatchObject({ enabled: true, cached: false, eventTypes: [{ name: 'fallback event' }] });
    expect(hit).toMatchObject({ enabled: true, cached: true, eventTypes: [{ name: 'fallback event' }] });
    expect(aAuthorizations).toEqual([
      `Bearer ${accountToken}`,
      `Bearer ${accountToken}`,
      `Bearer ${fallbackToken}`,
      `Bearer ${fallbackToken}`,
    ]);
    expect(bAuthorizations).toEqual([`Bearer ${accountToken}`]);
  });

  it('invalidates cached metadata when the account switches to and from an env fallback', async () => {
    const fallbackToken = 'calendly-fallback-0001';
    const accountToken = 'calendly-account-0002';
    const expectedAuthorizations = [
      `Bearer ${fallbackToken}`,
      `Bearer ${fallbackToken}`,
      `Bearer ${accountToken}`,
      `Bearer ${accountToken}`,
      `Bearer ${accountToken}`,
      `Bearer ${fallbackToken}`,
      `Bearer ${fallbackToken}`,
    ];
    let requests = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const request = requests++;
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (authorization !== expectedAuthorizations[request]) {
        throw new Error('unexpected Calendly authorization');
      }
      const expectsMe = request === 0 || request === 2 || request === 3 || request === 5;
      if ((expectsMe && url !== CALENDLY_ME_URL) || (!expectsMe && !url.startsWith(CALENDLY_EVENT_TYPES_BASE))) {
        throw new Error('unexpected Calendly request');
      }
      const suffix = request === 0 || request === 1 || request === 5 || request === 6 ? 'fallback' : 'account';
      if (url === CALENDLY_ME_URL) {
        return jsonResponse({ resource: { uri: `https://api.calendly.com/users/${suffix}` } });
      }
      return jsonResponse({
        collection: [
          {
            uri: `https://api.calendly.com/event_types/${suffix}`,
            name: `${suffix} event`,
            scheduling_url: `https://calendly.com/acme/${suffix}`,
          },
        ],
      });
    }) as unknown as typeof fetch;
    const { calendly } = build(makeEnv({ CALENDLY_API_TOKEN: fallbackToken }), fetchImpl);
    const id = await accountId();

    const fallback = await calendly.listEventTypes(id, 1_000);
    await controller.connect(asOwner(), 'calendly', { token: accountToken });
    const connected = await calendly.listEventTypes(id, 1_001);
    await controller.disconnect(asOwner(), 'calendly');
    const returnedToFallback = await calendly.listEventTypes(id, 1_002);

    expect(fallback).toMatchObject({ enabled: true, cached: false, eventTypes: [{ name: 'fallback event' }] });
    expect(connected).toMatchObject({ enabled: true, cached: false, eventTypes: [{ name: 'account event' }] });
    expect(returnedToFallback).toMatchObject({
      enabled: true,
      cached: false,
      eventTypes: [{ name: 'fallback event' }],
    });
    expect(requests).toBe(expectedAuthorizations.length);
  });

  it('keeps shared-token cached metadata isolated by account', async () => {
    const fallbackToken = 'shared-calendly-fallback-token';
    let eventTypeRequests = 0;
    const { calendly } = build(
      makeEnv({ CALENDLY_API_TOKEN: fallbackToken }),
      (async (url: string, init?: RequestInit) => {
        const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
        if (authorization !== `Bearer ${fallbackToken}`) {
          throw new Error('unexpected Calendly authorization');
        }
        if (url === CALENDLY_ME_URL) {
          return jsonResponse({ resource: { uri: 'https://api.calendly.com/users/shared' } });
        }
        if (url.startsWith(CALENDLY_EVENT_TYPES_BASE)) {
          eventTypeRequests += 1;
          const suffix = eventTypeRequests === 1 ? 'first-account' : 'second-account';
          return jsonResponse({
            collection: [
              {
                uri: `https://api.calendly.com/event_types/${suffix}`,
                name: suffix,
                scheduling_url: `https://calendly.com/acme/${suffix}`,
              },
            ],
          });
        }
        return new Response('{}', { status: 404 });
      }) as unknown as typeof fetch,
    );

    const first = await calendly.listEventTypes('first-account', 1_000);
    const second = await calendly.listEventTypes('second-account', 1_001);

    expect(first).toMatchObject({ enabled: true, cached: false, eventTypes: [{ name: 'first-account' }] });
    expect(second).toMatchObject({ enabled: true, cached: false, eventTypes: [{ name: 'second-account' }] });
    expect(eventTypeRequests).toBe(2);
  });
});
