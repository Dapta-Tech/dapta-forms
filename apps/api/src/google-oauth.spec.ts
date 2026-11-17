/**
 * The Google OAuth exchange, and above all its `state`.
 *
 * The callback route is unauthenticated by necessity: a browser arriving from
 * Google carries no session this host can read. The signed state is therefore
 * the ONLY thing standing between a consent flow and a refresh token written
 * against somebody else's account, so these specs are written from the
 * attacker's side first: forge it, tamper with it, re-sign it, replay it late.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  exchangeGoogleCode,
  googleAuthorizeUrl,
  googleOAuthClient,
  googlePickerConfig,
  googleStateKey,
  grantedSheetsAccess,
  refreshGoogleAccessToken,
  safeGoogleReturnTo,
  signGoogleState,
  verifyGoogleState,
  GOOGLE_STATE_MAX_LENGTH,
  GOOGLE_STATE_TTL_MS,
  type GoogleOAuthClient,
} from './google-oauth';

const KEY_A = Buffer.alloc(32, 1);
const KEY_B = Buffer.alloc(32, 2);
const ACCOUNT = 'acc_8f3c1d2e-0000-4000-8000-000000000001';
const NOW = 1_763_000_000_000;

const CLIENT: GoogleOAuthClient = {
  clientId: 'client-id.apps.googleusercontent.com',
  clientSecret: 'client-secret',
  redirectUri: 'https://api.example.test/v1/integrations/google-sheets/callback',
};

/** A token-endpoint answer, as Google shapes it. */
function tokenResponse(body: Record<string, unknown>, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

/** An unverified id_token: only its middle segment is ever read. */
function idToken(claims: Record<string, unknown>): string {
  const part = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `header.${part}.signature`;
}

describe('googleStateKey', () => {
  it('derives a key from the 32-byte encryption key', () => {
    const key = googleStateKey({ FORMS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') });
    expect(key).toHaveLength(32);
  });

  it('is never the encryption key itself, so one cannot stand in for the other', () => {
    const raw = Buffer.alloc(32, 7);
    const key = googleStateKey({ FORMS_ENCRYPTION_KEY: raw.toString('base64') });
    expect(key!.equals(raw)).toBe(false);
  });

  it('is null without a key, and null for a key of the wrong size', () => {
    expect(googleStateKey(undefined)).toBeNull();
    expect(googleStateKey({})).toBeNull();
    expect(googleStateKey({ FORMS_ENCRYPTION_KEY: Buffer.alloc(16, 7).toString('base64') })).toBeNull();
  });
});

describe('the state round trip', () => {
  it('carries the account it was minted for', () => {
    const state = signGoogleState(ACCOUNT, KEY_A, NOW);
    expect(verifyGoogleState(state, KEY_A, NOW + 1000)).toEqual({
      accountId: ACCOUNT,
      issuedAt: NOW,
    });
  });

  it('gives two flows started in the same millisecond different states', () => {
    const a = signGoogleState(ACCOUNT, KEY_A, NOW);
    const b = signGoogleState(ACCOUNT, KEY_A, NOW);
    expect(a).not.toBe(b);
    expect(verifyGoogleState(a, KEY_A, NOW)?.accountId).toBe(ACCOUNT);
    expect(verifyGoogleState(b, KEY_A, NOW)?.accountId).toBe(ACCOUNT);
  });
});

describe('a state this deployment did not sign is refused', () => {
  it('refuses a repeated state parameter, which a query string turns into an array', () => {
    const state = signGoogleState(ACCOUNT, KEY_A, NOW);
    expect(verifyGoogleState([state, state], KEY_A, NOW)).toBeNull();
    expect(verifyGoogleState([state], KEY_A, NOW)).toBeNull();
    expect(verifyGoogleState(undefined, KEY_A, NOW)).toBeNull();
  });

  it('refuses a signature from another key', () => {
    const state = signGoogleState(ACCOUNT, KEY_B, NOW);
    expect(verifyGoogleState(state, KEY_A, NOW)).toBeNull();
  });

  it('refuses a swapped account id, which is the whole attack', () => {
    // The payload is readable by anyone holding the state. Rewriting it to name
    // another account must not verify, or a stranger's consent would store a
    // refresh token against that account.
    const state = signGoogleState(ACCOUNT, KEY_A, NOW);
    const [version, payload, signature] = state.split('.');
    const fields = Buffer.from(payload!, 'base64url').toString('utf8').split('\n');
    const forged = Buffer.from(
      `acc_victim\n${fields[1]}\n${fields[2]}`,
      'utf8',
    ).toString('base64url');
    expect(verifyGoogleState(`${version}.${forged}.${signature}`, KEY_A, NOW)).toBeNull();
  });

  it('refuses a tampered signature', () => {
    const state = signGoogleState(ACCOUNT, KEY_A, NOW);
    const parts = state.split('.');
    const flipped = parts[2]!.slice(0, -1) + (parts[2]!.endsWith('A') ? 'B' : 'A');
    expect(verifyGoogleState(`${parts[0]}.${parts[1]}.${flipped}`, KEY_A, NOW)).toBeNull();
  });

  it('refuses an unsigned state', () => {
    const payload = Buffer.from(`${ACCOUNT}\n${NOW}\nnonce`, 'utf8').toString('base64url');
    expect(verifyGoogleState(`v1.${payload}.`, KEY_A, NOW)).toBeNull();
    expect(verifyGoogleState(`v1.${payload}`, KEY_A, NOW)).toBeNull();
  });

  it('refuses a version it does not know, so a v1 signature cannot be reused later', () => {
    const state = signGoogleState(ACCOUNT, KEY_A, NOW);
    expect(verifyGoogleState(state.replace(/^v1\./, 'v3.'), KEY_A, NOW)).toBeNull();
    // Relabelling a v1 state as v2 breaks its signature, and v2 wants four fields.
    expect(verifyGoogleState(state.replace(/^v1\./, 'v2.'), KEY_A, NOW)).toBeNull();
  });

  it('refuses junk, empty and non-base64url input', () => {
    for (const bad of ['', 'x', 'v1..', 'v1.@@@.@@@', 'a.b.c.d']) {
      expect(verifyGoogleState(bad, KEY_A, NOW)).toBeNull();
    }
  });

  it('refuses an over-long state before hashing it', () => {
    const state = `v1.${'A'.repeat(GOOGLE_STATE_MAX_LENGTH)}.${'A'.repeat(43)}`;
    expect(state.length).toBeGreaterThan(GOOGLE_STATE_MAX_LENGTH);
    expect(verifyGoogleState(state, KEY_A, NOW)).toBeNull();
  });
});

describe('a state is short lived', () => {
  it('is good inside the window', () => {
    const state = signGoogleState(ACCOUNT, KEY_A, NOW);
    expect(verifyGoogleState(state, KEY_A, NOW + GOOGLE_STATE_TTL_MS - 1)).not.toBeNull();
  });

  it('expires after it', () => {
    const state = signGoogleState(ACCOUNT, KEY_A, NOW);
    expect(verifyGoogleState(state, KEY_A, NOW + GOOGLE_STATE_TTL_MS + 1)).toBeNull();
  });

  it('refuses one issued in the future beyond the clock allowance', () => {
    const state = signGoogleState(ACCOUNT, KEY_A, NOW + 10 * 60_000);
    expect(verifyGoogleState(state, KEY_A, NOW)).toBeNull();
  });
});

describe('googleOAuthClient', () => {
  it('needs all three values', () => {
    expect(
      googleOAuthClient({
        GOOGLE_OAUTH_CLIENT_ID: 'id',
        GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
        GOOGLE_OAUTH_REDIRECT_URI: 'https://api.example.test/cb',
      }),
    ).toEqual({ clientId: 'id', clientSecret: 'secret', redirectUri: 'https://api.example.test/cb' });
  });

  it('is null when any one of them is missing or blank', () => {
    expect(googleOAuthClient(undefined)).toBeNull();
    expect(googleOAuthClient({ GOOGLE_OAUTH_CLIENT_ID: 'id' })).toBeNull();
    expect(
      googleOAuthClient({
        GOOGLE_OAUTH_CLIENT_ID: 'id',
        GOOGLE_OAUTH_CLIENT_SECRET: '   ',
        GOOGLE_OAUTH_REDIRECT_URI: 'https://api.example.test/cb',
      }),
    ).toBeNull();
  });
});

describe('googleAuthorizeUrl', () => {
  it('asks for offline access with a forced consent, so a refresh token always comes back', () => {
    const url = new URL(googleAuthorizeUrl(CLIENT, 'the-state'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('the-state');
    expect(url.searchParams.get('redirect_uri')).toBe(CLIENT.redirectUri);
    expect(url.searchParams.get('client_id')).toBe(CLIENT.clientId);
  });

  // The scope is the difference between a consent screen anyone can accept and
  // "Google hasn't verified this app" with a hundred-user cap. `drive.file` is
  // the non-sensitive one; `spreadsheets` and full `drive` both need a review.
  it('asks for drive.file and for no scope Google classes as sensitive', () => {
    const url = new URL(googleAuthorizeUrl(CLIENT, 's'));
    const scopes = url.searchParams.get('scope')!.split(' ');
    expect(scopes.sort()).toEqual(
      ['email', 'https://www.googleapis.com/auth/drive.file', 'openid'].sort(),
    );
    expect(scopes).not.toContain('https://www.googleapis.com/auth/spreadsheets');
    expect(scopes).not.toContain('https://www.googleapis.com/auth/drive');
  });

  it('never puts the client secret in the URL the browser follows', () => {
    expect(googleAuthorizeUrl(CLIENT, 's')).not.toContain(CLIENT.clientSecret);
  });
});

describe('exchangeGoogleCode', () => {
  it('returns the refresh token, the granted scopes and the connected email', async () => {
    const fetchImpl = tokenResponse({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3599,
      scope: 'https://www.googleapis.com/auth/drive.file openid email',
      id_token: idToken({ email: 'ops@example.com' }),
    });
    await expect(exchangeGoogleCode(CLIENT, 'the-code', fetchImpl)).resolves.toEqual({
      refreshToken: 'rt',
      accessToken: 'at',
      expiresInSec: 3599,
      scopes: ['https://www.googleapis.com/auth/drive.file', 'openid', 'email'],
      email: 'ops@example.com',
    });
  });

  it('posts the code and the secret as a form, never as a query string', async () => {
    const fetchImpl = tokenResponse({ access_token: 'at', refresh_token: 'rt' });
    await exchangeGoogleCode(CLIENT, 'the-code', fetchImpl);
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(url).not.toContain('the-code');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('client_secret')).toBe(CLIENT.clientSecret);
  });

  it('is null when Google answers without a refresh token', async () => {
    // An access token alone would give a connection that stops delivering in an
    // hour with no way to renew it. Refusing to connect is the better answer.
    const fetchImpl = tokenResponse({ access_token: 'at', expires_in: 3600 });
    await expect(exchangeGoogleCode(CLIENT, 'c', fetchImpl)).resolves.toBeNull();
  });

  it('is null when Google refuses the code', async () => {
    const fetchImpl = tokenResponse({ error: 'invalid_grant' }, false);
    await expect(exchangeGoogleCode(CLIENT, 'c', fetchImpl)).resolves.toBeNull();
  });

  it('leaves the email null when the id_token is absent or unreadable', async () => {
    for (const id of [undefined, 'not-a-jwt', 'a.@@@.c']) {
      const fetchImpl = tokenResponse({ access_token: 'at', refresh_token: 'rt', id_token: id });
      const tokens = await exchangeGoogleCode(CLIENT, 'c', fetchImpl);
      expect(tokens?.email).toBeNull();
    }
  });
});

describe('refreshGoogleAccessToken', () => {
  it('trades the refresh token for an access token', async () => {
    const fetchImpl = tokenResponse({ access_token: 'fresh', expires_in: 3599 });
    await expect(refreshGoogleAccessToken(CLIENT, 'rt', fetchImpl)).resolves.toEqual({
      accessToken: 'fresh',
      expiresInSec: 3599,
    });
    const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    expect(new URLSearchParams(String(init.body)).get('grant_type')).toBe('refresh_token');
  });

  it('is null when Google refuses, which is a permanent refusal and not a retry', async () => {
    const fetchImpl = tokenResponse({ error: 'invalid_grant' }, false);
    await expect(refreshGoogleAccessToken(CLIENT, 'rt', fetchImpl)).resolves.toBeNull();
  });

  it('propagates a transport failure, which IS the retryable case', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    await expect(refreshGoogleAccessToken(CLIENT, 'rt', fetchImpl)).rejects.toThrow('ECONNRESET');
  });
});

describe('grantedSheetsAccess', () => {
  it('is true only when the drive.file scope actually came back', () => {
    expect(grantedSheetsAccess(['https://www.googleapis.com/auth/drive.file', 'openid'])).toBe(true);
    // Someone unticked it on the consent screen: Google answers 200 with less.
    expect(grantedSheetsAccess(['openid', 'email'])).toBe(false);
    expect(grantedSheetsAccess([])).toBe(false);
  });

  it('does not take the scope this app no longer asks for as a grant', () => {
    expect(grantedSheetsAccess(['https://www.googleapis.com/auth/spreadsheets'])).toBe(false);
  });
});

describe('googlePickerConfig', () => {
  const CLIENT_ID = '123456789012-abcdef.apps.googleusercontent.com';

  it('is null without a browser key, which is what leaves the Picker out', () => {
    expect(googlePickerConfig({ GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID })).toBeNull();
    expect(googlePickerConfig({ GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID, GOOGLE_PICKER_API_KEY: '  ' })).toBeNull();
    expect(googlePickerConfig(undefined)).toBeNull();
  });

  // The app id must be the project that owns the OAuth client, or picking a
  // file grants this app nothing. Reading it off the client id keeps them one.
  it('reads the app id off the client id, so the two cannot drift', () => {
    expect(
      googlePickerConfig({ GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID, GOOGLE_PICKER_API_KEY: 'browser-key' }),
    ).toEqual({ apiKey: 'browser-key', appId: '123456789012' });
  });

  it('lets an explicit app id win', () => {
    expect(
      googlePickerConfig({
        GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID,
        GOOGLE_PICKER_API_KEY: 'browser-key',
        GOOGLE_PICKER_APP_ID: '999',
      }),
    ).toEqual({ apiKey: 'browser-key', appId: '999' });
  });

  it('is null when no app id can be had, rather than opening a Picker that grants nothing', () => {
    expect(
      googlePickerConfig({ GOOGLE_OAUTH_CLIENT_ID: 'not-a-google-id', GOOGLE_PICKER_API_KEY: 'k' }),
    ).toBeNull();
  });
});

describe('the return path a state carries', () => {
  const FORM = '/admin/forms/3f1c2a4e-0000-4000-8000-000000000001/edit';

  it('round-trips a form editor path, signed inside the state', () => {
    const state = signGoogleState(ACCOUNT, KEY_A, NOW, FORM);
    expect(state.startsWith('v2.')).toBe(true);
    expect(verifyGoogleState(state, KEY_A, NOW)).toEqual({
      accountId: ACCOUNT,
      issuedAt: NOW,
      returnTo: FORM,
    });
  });

  it('mints the old v1 state when there is no path, so nothing else changes', () => {
    const state = signGoogleState(ACCOUNT, KEY_A, NOW);
    expect(state.startsWith('v1.')).toBe(true);
    expect(verifyGoogleState(state, KEY_A, NOW)).toEqual({ accountId: ACCOUNT, issuedAt: NOW });
  });

  it('refuses a swapped return path, the same way it refuses a swapped account', () => {
    const state = signGoogleState(ACCOUNT, KEY_A, NOW, FORM);
    const [version, payload, signature] = state.split('.');
    const fields = Buffer.from(payload!, 'base64url').toString('utf8').split('\n');
    fields[3] = '/admin/forms/someone-else/edit';
    const forged = Buffer.from(fields.join('\n'), 'utf8').toString('base64url');
    expect(verifyGoogleState(`${version}.${forged}.${signature}`, KEY_A, NOW)).toBeNull();
  });

  it('never signs anything but one of the two dashboard paths', () => {
    for (const bad of [
      'https://evil.example/admin/integrations',
      '//evil.example/admin/integrations',
      '/\\evil.example',
      '/admin/forms/x/edit?next=https://evil.example',
      '/admin/forms/x/edit#frag',
      '/admin/forms/../../logout/edit',
      '/admin/forms/x%2F..%2F/edit',
      '/admin/integrations\n/evil',
      '/login',
      '',
    ]) {
      expect(safeGoogleReturnTo(bad)).toBeNull();
      expect(signGoogleState(ACCOUNT, KEY_A, NOW, bad).startsWith('v1.')).toBe(true);
    }
    expect(safeGoogleReturnTo('/admin/integrations')).toBe('/admin/integrations');
    expect(safeGoogleReturnTo(FORM)).toBe(FORM);
  });
});
