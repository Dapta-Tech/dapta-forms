/**
 * The Google OAuth exchange behind the Google Sheets destination.
 *
 * Every other provider in `account_integration` is connected by pasting a token
 * the operator already holds. Google does not work that way: there is nothing to
 * paste, the operator has to be sent to Google and sent back. That makes the
 * callback the odd one out in this API, because a browser arriving from Google
 * carries no `Authorization` header and no cookie this host can read (the
 * dashboard session is the WEB app's, on another origin).
 *
 * So the flow is split in two, and the state is what joins them:
 *
 *   1. `POST /v1/integrations/google-sheets/authorize` is an ORDINARY admin
 *      route. It resolves the principal the usual way and mints a `state` that
 *      carries the account id, signed with a key derived from the deployment's
 *      own secret and good for ten minutes.
 *   2. `GET /v1/integrations/google-sheets/callback` trusts nothing but that
 *      signature. A valid state IS the authorization: it proves an admin of that
 *      exact account started this flow on this deployment, recently. A forged or
 *      expired one is refused before the code is redeemed.
 *
 * That design is what keeps the account id out of the attacker's hands. Were the
 * callback to take the account from a query parameter, anyone could walk their
 * own Google consent and have the resulting token stored against someone else's
 * workspace, which is a credential-injection bug, not a login bug.
 *
 * The CLIENT is the deployment's, not the end user's: one Google OAuth client
 * serves every account, and all that is persisted per account is its refresh
 * token. The client secret therefore never reaches the database, and rotating
 * the client invalidates every stored refresh token at once, which is the
 * revocation story.
 */
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ServerEnv } from '@quill/config/env';

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/**
 * The one Drive scope Google classes as NON-sensitive: access to the files this
 * app created, and to the ones the user hands it through Google's own Picker.
 *
 * Deliberately NOT `spreadsheets`. That scope reaches every spreadsheet the
 * account can open, which is why Google classes it sensitive: a client asking
 * for it shows "Google hasn't verified this app" and is capped at a hundred
 * users until a review that takes weeks. `drive.file` needs no review, and the
 * Sheets API accepts it for the two things the destination does (create a
 * spreadsheet, append a row), so the narrower scope costs nothing but the
 * ability to open a spreadsheet by an id somebody pasted.
 *
 * That last point shapes the product: a spreadsheet reaches a form by being
 * created here or chosen in the Picker, never by a pasted link. A pasted id
 * would answer 404 from Google, indistinguishable from a deleted file.
 *
 * `openid email` rides along only so the connected card can say WHICH Google
 * account is attached, which is the difference between a connection someone can
 * audit and an opaque green dot.
 */
export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_SHEETS_SCOPES = [GOOGLE_DRIVE_FILE_SCOPE, 'openid', 'email'] as const;

/** The state format label, first segment of every state string. */
export const GOOGLE_STATE_VERSION = 'v1';
/** HKDF `info`: binds the derived key to this one use. */
export const GOOGLE_STATE_KEY_LABEL = 'dforms-google-oauth-state-v1';
/** How long a started flow stays redeemable. Long enough to read a consent screen. */
export const GOOGLE_STATE_TTL_MS = 10 * 60_000;
/**
 * Longest state either side will touch. A real one is well under 200 characters;
 * anything past this is refused before a byte of it is decoded or hashed.
 */
export const GOOGLE_STATE_MAX_LENGTH = 512;

const B64URL_RE = /^[A-Za-z0-9_-]+$/;

type GoogleOAuthEnv = Partial<
  Pick<
    ServerEnv,
    | 'GOOGLE_OAUTH_CLIENT_ID'
    | 'GOOGLE_OAUTH_CLIENT_SECRET'
    | 'GOOGLE_OAUTH_REDIRECT_URI'
    | 'FORMS_ENCRYPTION_KEY'
  >
>;

type GooglePickerEnv = Partial<
  Pick<ServerEnv, 'GOOGLE_OAUTH_CLIENT_ID' | 'GOOGLE_PICKER_API_KEY' | 'GOOGLE_PICKER_APP_ID'>
>;

/** The deployment's Google OAuth client, as the two routes need it. */
export interface GoogleOAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * The configured client, or null when this deployment has none.
 *
 * All three values or nothing: a client id without its secret cannot redeem a
 * code, and either without the redirect URI cannot even start, so a partial
 * configuration is treated as absent rather than allowed to fail halfway
 * through somebody's consent screen.
 */
export function googleOAuthClient(env: GoogleOAuthEnv | undefined): GoogleOAuthClient | null {
  const clientId = env?.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env?.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = env?.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

/**
 * The HMAC key for the state, or null when this deployment has no secret to
 * derive one from. Mirrors `fileLinkKey`: the 32-byte `FORMS_ENCRYPTION_KEY`
 * goes through HKDF under a label of its own, so the key that encrypts stored
 * tokens is never used directly as a MAC key.
 */
export function googleStateKey(env: GoogleOAuthEnv | undefined): Buffer | null {
  const raw = env?.FORMS_ENCRYPTION_KEY;
  if (!raw) return null;
  const material = Buffer.from(raw, 'base64');
  if (material.length !== 32) return null;
  return Buffer.from(hkdfSync('sha256', material, Buffer.alloc(0), GOOGLE_STATE_KEY_LABEL, 32));
}

/** What a verified state authorizes: one connect, for one account. */
export interface GoogleStateClaims {
  accountId: string;
  issuedAt: number;
  /**
   * The dashboard path the flow was started from, when it was started
   * somewhere other than the connections page (a form's Connect tab). Present
   * only on a v2 state, and only when it passed `safeGoogleReturnTo` both when
   * it was signed and again when it was read.
   */
  returnTo?: string;
}

/** The state format that also carries where to send the browser back. */
export const GOOGLE_STATE_VERSION_RETURN = 'v2';

/**
 * The only paths a finished consent flow may return to: the connections page,
 * or one form's editor (the callback adds `tab=connect`).
 *
 * An allowlist of two shapes rather than "any path under /admin": the value
 * ends up in a `Location` header, and the narrower the set, the less there is
 * to reason about. A path only, never a URL: the callback prefixes the
 * deployment's own `PUBLIC_APP_URL`, so a value that is not a bare path (a
 * scheme, `//host`, a backslash, a query, an encoded character) cannot change
 * which origin the browser lands on. It is checked when the state is signed
 * AND when it is read, so a key compromise is the only way to get anything
 * else through, and even then it is still a path on this origin.
 */
const RETURN_TO_RE = /^\/admin\/(?:integrations|forms\/[A-Za-z0-9_-]{1,64}\/edit)$/;

/** The return path if it is one of the allowed shapes, else null. */
export function safeGoogleReturnTo(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  return RETURN_TO_RE.test(raw) ? raw : null;
}

const b64url = (b: Buffer): string => b.toString('base64url');

function sign(key: Buffer, signed: string): string {
  return b64url(createHmac('sha256', key).update(signed).digest());
}

/**
 * Mint a state for one account.
 *
 * Format, version 1: `v1.<payload>.<signature>`, where the payload is base64url
 * of `${accountId}\n${issuedAt}\n${nonce}` and the signature covers
 * `v1.<payload>`. The version label is inside the signed bytes, so a later
 * format can never be handed a v1 signature, and a newline appears in none of
 * the three fields (a UUID, a number, base64url), so the split is unambiguous.
 *
 * Version 2 adds a fourth field, the dashboard path to return to (see
 * `safeGoogleReturnTo`, which forbids a newline among everything else), and
 * is minted only when there is one. Signed like the rest, so the callback can
 * redirect to it without trusting anything the browser brought back.
 *
 * The nonce makes two flows started in the same millisecond distinct. It is not
 * recorded anywhere: a state is single-use in practice because Google refuses to
 * redeem a code twice, and keeping a table of nonces would buy only the ability
 * to refuse the second attempt a few milliseconds earlier.
 */
export function signGoogleState(
  accountId: string,
  key: Buffer,
  now: number = Date.now(),
  returnTo?: string | null,
): string {
  // Version 2 is version 1 with a fourth field, the return path. Minted only
  // when there IS a path to carry, so a flow started on the connections page
  // still produces exactly the v1 state it always did.
  const back = safeGoogleReturnTo(returnTo);
  const fields = [accountId, String(now), b64url(randomBytes(8))];
  if (back) fields.push(back);
  const payload = b64url(Buffer.from(fields.join('\n'), 'utf8'));
  const signed = `${back ? GOOGLE_STATE_VERSION_RETURN : GOOGLE_STATE_VERSION}.${payload}`;
  return `${signed}.${sign(key, signed)}`;
}

/**
 * The claims of a state this deployment signed and has not yet expired, or null.
 *
 * Null for every reason a state can be unusable: too long, malformed, a bad
 * signature, a future issue time (a clock that moved, or a crafted value), or
 * simply old. The caller turns all of them into the same refusal, because
 * telling a caller WHICH of those it was is free help for forging the next one.
 */
export function verifyGoogleState(
  state: unknown,
  key: Buffer,
  now: number = Date.now(),
): GoogleStateClaims | null {
  // A query string can repeat a parameter, which reaches here as an array.
  // Anything but a string is refused before `.length` or `.split` touch it.
  if (typeof state !== 'string' || !state || state.length > GOOGLE_STATE_MAX_LENGTH) return null;
  const parts = state.split('.');
  if (parts.length !== 3) return null;
  const [version, payload, signature] = parts as [string, string, string];
  if (version !== GOOGLE_STATE_VERSION && version !== GOOGLE_STATE_VERSION_RETURN) return null;
  if (!B64URL_RE.test(payload) || !B64URL_RE.test(signature)) return null;

  const expected = sign(key, `${version}.${payload}`);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const fields = Buffer.from(payload, 'base64url').toString('utf8').split('\n');
  // The field count is tied to the version, so a v1 signature can never be
  // stretched to cover a return path it was not minted with.
  if (fields.length !== (version === GOOGLE_STATE_VERSION ? 3 : 4)) return null;
  const accountId = fields[0]!;
  const issuedAt = Number(fields[1]);
  if (!accountId || !Number.isSafeInteger(issuedAt)) return null;
  if (issuedAt > now + 60_000) return null;
  if (now - issuedAt > GOOGLE_STATE_TTL_MS) return null;
  if (version === GOOGLE_STATE_VERSION) return { accountId, issuedAt };
  const returnTo = safeGoogleReturnTo(fields[3]);
  if (!returnTo) return null;
  return { accountId, issuedAt, returnTo };
}

/**
 * Where to send the operator to consent.
 *
 * `access_type=offline` with `prompt=consent` is the pair that guarantees a
 * refresh token. Offline alone is not enough: Google returns a refresh token
 * only on the FIRST consent for a client and account pair, so somebody who
 * connected, disconnected and reconnected would come back with an access token
 * that dies in an hour and no way to renew it. Forcing the consent screen every
 * time costs one extra click and removes that whole class of dead connection.
 */
export function googleAuthorizeUrl(client: GoogleOAuthClient, state: string): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', client.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_SHEETS_SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'false');
  url.searchParams.set('state', state);
  return url.toString();
}

/** What a redeemed code gave us. */
export interface GoogleTokens {
  /** The long-lived credential, the only part that is stored. */
  refreshToken: string;
  accessToken: string;
  expiresInSec: number;
  /** The scopes Google actually granted, which can be fewer than asked. */
  scopes: string[];
  /** The connected Google account, for the card's label. Null when absent. */
  email: string | null;
}

interface GoogleTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  id_token?: unknown;
}

/**
 * The email in an `id_token`, read WITHOUT verifying it.
 *
 * Safe here and nowhere else: this token came back on our own TLS connection to
 * Google's token endpoint, in response to a request carrying our client secret,
 * so there is no third party in the path to forge it. It is used only as a
 * display label on the connections card and never as an identity: nothing in
 * this codebase authorizes anything on the strength of it. Any other use needs
 * real signature verification.
 */
function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  const payload = idToken.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      email?: unknown;
    };
    const email = typeof claims.email === 'string' ? claims.email.trim() : '';
    return email || null;
  } catch {
    return null;
  }
}

function parseTokens(body: GoogleTokenResponse): GoogleTokens | null {
  const accessToken = typeof body.access_token === 'string' ? body.access_token : '';
  const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : '';
  if (!accessToken || !refreshToken) return null;
  const expiresInSec = Number.isFinite(body.expires_in) ? Number(body.expires_in) : 3600;
  const scopes = typeof body.scope === 'string' ? body.scope.split(' ').filter(Boolean) : [];
  return {
    refreshToken,
    accessToken,
    expiresInSec,
    scopes,
    email: emailFromIdToken(body.id_token),
  };
}

async function postForm(
  endpoint: string,
  form: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<GoogleTokenResponse | null> {
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as GoogleTokenResponse | null;
}

/**
 * Redeem an authorization code. Null when Google refused it or answered without
 * a refresh token, which is the one answer this flow cannot work with: an
 * access token alone would give a connection that silently stops delivering an
 * hour later, and storing it would be worse than refusing to connect.
 */
export async function exchangeGoogleCode(
  client: GoogleOAuthClient,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleTokens | null> {
  const body = await postForm(
    GOOGLE_TOKEN_ENDPOINT,
    {
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: client.redirectUri,
      grant_type: 'authorization_code',
    },
    fetchImpl,
  );
  return body ? parseTokens(body) : null;
}

/** A refreshed access token, with the seconds it is good for. */
export interface GoogleAccessToken {
  accessToken: string;
  expiresInSec: number;
}

/**
 * Trade a stored refresh token for an access token.
 *
 * This is what every delivery calls, so the distinction the return value makes
 * matters: null means Google REFUSED (the operator revoked access, the client
 * rotated, the token was pruned after months of disuse), and a refusal is
 * permanent. The caller must not retry it forever; it degrades the delivery and
 * leaves the connection to be reconnected by a human. A transport failure
 * throws instead, which is the retryable case.
 */
export async function refreshGoogleAccessToken(
  client: GoogleOAuthClient,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleAccessToken | null> {
  const body = await postForm(
    GOOGLE_TOKEN_ENDPOINT,
    {
      refresh_token: refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      grant_type: 'refresh_token',
    },
    fetchImpl,
  );
  if (!body) return null;
  const accessToken = typeof body.access_token === 'string' ? body.access_token : '';
  if (!accessToken) return null;
  return {
    accessToken,
    expiresInSec: Number.isFinite(body.expires_in) ? Number(body.expires_in) : 3600,
  };
}

/**
 * True when Google granted the one scope the destination cannot work without.
 *
 * A consent screen lets somebody untick scopes, and Google answers 200 with the
 * reduced set rather than an error. Without this check the connect would look
 * like it worked and every delivery would fail with a 403 that names a scope the
 * operator was never told about.
 */
export function grantedSheetsAccess(scopes: string[]): boolean {
  return scopes.includes(GOOGLE_DRIVE_FILE_SCOPE);
}

/**
 * What the browser needs to open Google's Picker, or null when this deployment
 * cannot offer one.
 *
 * The Picker is how an EXISTING spreadsheet reaches a form under `drive.file`:
 * choosing a file in it is what grants this app access to that file. It runs in
 * the browser and takes a browser API key (public by nature, restricted by
 * referrer on Google's side) and the Cloud project number as its app id.
 *
 * The app id has to be the project that owns the OAuth client, or picking a
 * file grants nothing. That is why it is read off the client id by default: a
 * Google client id is `<project number>-<hash>.apps.googleusercontent.com`, so
 * the two cannot drift. `GOOGLE_PICKER_APP_ID` overrides it for a client id
 * that does not follow the shape.
 *
 * Without the key there is no Picker and the card offers only "create a new
 * spreadsheet", which needs nothing but the consent already given.
 */
export function googlePickerConfig(
  env: GooglePickerEnv | undefined,
): { apiKey: string; appId: string } | null {
  const apiKey = env?.GOOGLE_PICKER_API_KEY?.trim();
  if (!apiKey) return null;
  const explicit = env?.GOOGLE_PICKER_APP_ID?.trim();
  const fromClient = /^(\d+)-/.exec(env?.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? '')?.[1];
  const appId = explicit || fromClient;
  if (!appId) return null;
  return { apiKey, appId };
}
