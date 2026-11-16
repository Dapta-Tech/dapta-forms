/**
 * Minting the access token a Google Sheets delivery writes with.
 *
 * The behaviour worth pinning is the split the outbox depends on:
 *
 *   - Google REFUSED the refresh: permanent. An empty token comes back, the
 *     factory degrades to a log-only no-op, and the delivery is marked done.
 *     Retrying a refused grant is how an integration hammers a provider for a
 *     week after somebody clicked "remove access".
 *   - Nothing ANSWERED: transient. It throws, so the delivery fails and the
 *     outbox's backoff gets its turn.
 *
 * Plus the cache, which exists so a burst of submissions for one account does
 * not spend that account's Google quota on tokens, and its renewal margin,
 * which exists because this adapter treats a 401 as permanent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, migrate, seed, getAccountByCode, upsertIntegration, type Db } from '@quill/db';
import type { ServerEnv } from '@quill/config/env';
import {
  GoogleSheetsAccessTokens,
  GOOGLE_TOKEN_MAX_CACHE_MS,
  GOOGLE_TOKEN_RENEW_MARGIN_MS,
} from './google-sheets-token';

const KEY = Buffer.alloc(32, 9).toString('base64');

const ENV = {
  FORMS_ENCRYPTION_KEY: KEY,
  GOOGLE_OAUTH_CLIENT_ID: 'cid.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET: 'csecret',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://api.example.test/cb',
} as unknown as ServerEnv;

let db: Db;
let accountId: string;

/** Google's token endpoint, answering however the test needs. */
function token(body: Record<string, unknown>, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
  accountId = (await getAccountByCode(db, 'acme'))!.id;
});

/** Connect the account, as the consent callback does. */
const connect = (refreshToken = 'rt') =>
  upsertIntegration(db, accountId, 'google-sheets', refreshToken, KEY, 'ops@example.com');

describe('with no connection', () => {
  it('is empty when the account has never connected', async () => {
    const fetchImpl = token({});
    await expect(
      new GoogleSheetsAccessTokens().resolve(db, accountId, ENV, fetchImpl),
    ).resolves.toBe('');
    // And asks Google nothing: there is no refresh token to redeem.
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });

  it('is empty when the deployment has no Google client, whatever is stored', async () => {
    await connect();
    const bare = { FORMS_ENCRYPTION_KEY: KEY } as unknown as ServerEnv;
    await expect(
      new GoogleSheetsAccessTokens().resolve(db, accountId, bare, token({})),
    ).resolves.toBe('');
  });
});

describe('minting', () => {
  it('redeems the stored refresh token', async () => {
    await connect('the-refresh-token');
    const fetchImpl = token({ access_token: 'ya29.fresh', expires_in: 3600 });
    await expect(
      new GoogleSheetsAccessTokens().resolve(db, accountId, ENV, fetchImpl),
    ).resolves.toBe('ya29.fresh');
    const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    const body = new URLSearchParams(String(init.body));
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('the-refresh-token');
  });
});

describe('a refusal is permanent', () => {
  it('comes back empty rather than throwing, so the delivery is not retried', async () => {
    await connect();
    const fetchImpl = token({ error: 'invalid_grant' }, false);
    await expect(
      new GoogleSheetsAccessTokens().resolve(db, accountId, ENV, fetchImpl),
    ).resolves.toBe('');
  });

  it('drops any cached token, because the grant behind it is gone', async () => {
    await connect();
    const tokens = new GoogleSheetsAccessTokens();
    await tokens.resolve(db, accountId, ENV, token({ access_token: 'a', expires_in: 3600 }), 0);
    // Past the cache: the next resolve goes back to Google, and is refused.
    const refused = token({ error: 'invalid_grant' }, false);
    await expect(
      tokens.resolve(db, accountId, ENV, refused, GOOGLE_TOKEN_MAX_CACHE_MS + 1),
    ).resolves.toBe('');
    // The dead token is not served afterwards either.
    const next = token({ error: 'invalid_grant' }, false);
    await expect(tokens.resolve(db, accountId, ENV, next, GOOGLE_TOKEN_MAX_CACHE_MS + 2)).resolves.toBe('');
    expect((next as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });
});

describe('a transport failure is transient', () => {
  it('throws, so the outbox retries it', async () => {
    await connect();
    const dead = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    await expect(
      new GoogleSheetsAccessTokens().resolve(db, accountId, ENV, dead),
    ).rejects.toThrow('ECONNRESET');
  });
});

describe('the cache', () => {
  it('serves a burst from one mint', async () => {
    await connect();
    const tokens = new GoogleSheetsAccessTokens();
    const fetchImpl = token({ access_token: 'ya29.a', expires_in: 3600 });
    for (let i = 0; i < 5; i++) {
      await expect(tokens.resolve(db, accountId, ENV, fetchImpl, 1000 + i)).resolves.toBe('ya29.a');
    }
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });

  it('renews before Google’s own expiry, because a 401 here is treated as permanent', async () => {
    await connect();
    const tokens = new GoogleSheetsAccessTokens();
    // A SHORT life on purpose: with Google's usual hour, the 50-minute cap
    // below bites first and would hide the margin this test is about.
    const lifeMs = 600_000;
    await tokens.resolve(db, accountId, ENV, token({ access_token: 'old', expires_in: 600 }), 0);
    // One millisecond inside the margin the token is still served; past it, a
    // fresh one is minted even though Google's own expiry has not arrived.
    const stillGood = token({ access_token: 'new', expires_in: 600 });
    await expect(
      tokens.resolve(db, accountId, ENV, stillGood, lifeMs - GOOGLE_TOKEN_RENEW_MARGIN_MS - 1),
    ).resolves.toBe('old');
    const renewed = token({ access_token: 'new', expires_in: 600 });
    await expect(
      tokens.resolve(db, accountId, ENV, renewed, lifeMs - GOOGLE_TOKEN_RENEW_MARGIN_MS + 1),
    ).resolves.toBe('new');
  });

  it('never trusts an over-long expiry', async () => {
    await connect();
    const tokens = new GoogleSheetsAccessTokens();
    await tokens.resolve(db, accountId, ENV, token({ access_token: 'a', expires_in: 86_400 }), 0);
    const renewed = token({ access_token: 'b', expires_in: 86_400 });
    await expect(
      tokens.resolve(db, accountId, ENV, renewed, GOOGLE_TOKEN_MAX_CACHE_MS + 1),
    ).resolves.toBe('b');
  });

  it('is keyed per account, so one workspace never writes with another’s token', async () => {
    await connect('acme-refresh');
    const tokens = new GoogleSheetsAccessTokens();
    await tokens.resolve(db, accountId, ENV, token({ access_token: 'acme', expires_in: 3600 }), 0);
    // A different account, with no connection of its own, must not be served
    // the cached token: a cache keyed globally would write one workspace's
    // submissions into another workspace's spreadsheet.
    const other = token({ access_token: 'other', expires_in: 3600 });
    await expect(tokens.resolve(db, 'another-account', ENV, other, 1)).resolves.toBe('');
    expect((other as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });

  it('forgets an account on demand', async () => {
    await connect();
    const tokens = new GoogleSheetsAccessTokens();
    await tokens.resolve(db, accountId, ENV, token({ access_token: 'a', expires_in: 3600 }), 0);
    tokens.invalidate(accountId);
    const again = token({ access_token: 'b', expires_in: 3600 });
    await expect(tokens.resolve(db, accountId, ENV, again, 1)).resolves.toBe('b');
  });
});
