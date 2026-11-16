/**
 * The Salesforce connection: what is stored, how it becomes a token, and the
 * token cache the delivery path and the field picker share.
 *
 * WHY CLIENT CREDENTIALS. Salesforce has no API keys. The one server-to-server
 * credential an admin can paste is an External Client App with the Client
 * Credentials Flow on and a Run As user: three values (the org's My Domain,
 * the consumer key, the consumer secret) that mint an access token on demand.
 * The one-click OAuth alternative would leave Dapta owning, packaging and
 * defending a Salesforce app for every customer org; this leaves nothing on
 * our side but the encrypted values.
 *
 * WHY THE DOMAIN IS CHECKED BEFORE ANYTHING IS SENT. The consumer secret is
 * posted to `{domain}/services/oauth2/token`. A domain the author can type
 * freely is a domain the secret can be exfiltrated to, so only an org's own
 * My Domain host (`*.my.salesforce.com`, sandboxes and Developer Edition
 * included) is accepted. `login.salesforce.com` is refused too: Client
 * Credentials only works on My Domain, so allowing it would only produce a
 * confusing "request not supported on this domain" later.
 */
import { Injectable } from '@nestjs/common';
import { resolveProviderToken, type Db } from '@quill/db';
import type { ServerEnv } from '@quill/config/env';
import { SALESFORCE_API_VERSION } from '@quill/destinations';

export interface SalesforceCredentials {
  /** `https://<org>.my.salesforce.com`, normalized to its origin. */
  domain: string;
  consumerKey: string;
  consumerSecret: string;
}

/**
 * Give up on a token or probe call that never settles.
 *
 * Eight seconds, not fifteen: connecting makes two of these calls in a row,
 * and the browser gives a server action fifteen seconds by default. At fifteen
 * each, a slow or unreachable org outlived the button, which then reported a
 * generic "could not connect" instead of the "Salesforce did not answer" this
 * route returns.
 */
const SALESFORCE_AUTH_TIMEOUT_MS = 8_000;

/**
 * Re-mint at least this often. Salesforce's shortest session timeout an admin
 * can pick is 15 minutes, and a Client Credentials token answers with no
 * expiry of its own, so a cache under 15 minutes can never hand out a token
 * the org has already expired.
 */
export const SALESFORCE_TOKEN_CACHE_MS = 10 * 60_000;

/**
 * The org's My Domain origin, or null for anything that is not one.
 *
 * Forgiving about what an admin pastes (no scheme, a trailing path, a Lightning
 * URL copied from the address bar) and strict about where it points.
 */
export function normalizeSalesforceDomain(raw: string): string | null {
  let text = raw.trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  let host = url.hostname.toLowerCase();
  // An admin copying the address bar gets the Lightning host, which points at
  // the same org: `acme.lightning.force.com` is `acme.my.salesforce.com`.
  host = host.replace(/\.lightning\.force\.com$/, '.my.salesforce.com');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.my\.salesforce\.com$/.test(host)) return null;
  return `https://${host}`;
}

/** The stored JSON, or null for a row that does not hold one. */
export function parseSalesforceCredentials(stored: string | null): SalesforceCredentials | null {
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<SalesforceCredentials>;
    const domain = typeof parsed.domain === 'string' ? normalizeSalesforceDomain(parsed.domain) : null;
    if (!domain || !parsed.consumerKey?.trim() || !parsed.consumerSecret?.trim()) return null;
    return { domain, consumerKey: parsed.consumerKey.trim(), consumerSecret: parsed.consumerSecret.trim() };
  } catch {
    return null;
  }
}

export type SalesforceMintResult =
  | { ok: true; accessToken: string; instanceUrl: string }
  | {
      ok: false;
      /**
       * `invalid_client`: the key or the secret is wrong, or the app is younger
       *   than Salesforce's propagation delay (up to 10 minutes).
       * `no_run_as`: the app has no Run As user, which Client Credentials requires.
       * `rejected`: any other refusal (the flow is off, the org has no API access).
       */
      reason: 'invalid_client' | 'no_run_as' | 'rejected';
    };

/**
 * Exchange the three values for an access token.
 *
 * A REFUSAL resolves (`ok:false`), because it will not change on a retry; a
 * transport failure THROWS, because it might. The delivery path relies on the
 * split: a refused mint degrades the destination, a thrown one is retried.
 * Salesforce's error body is never returned, only the classified reason.
 */
export async function mintSalesforceToken(
  creds: SalesforceCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<SalesforceMintResult> {
  const res = await fetchImpl(`${creds.domain}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: creds.consumerKey,
      client_secret: creds.consumerSecret,
    }).toString(),
    signal: AbortSignal.timeout(SALESFORCE_AUTH_TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => null)) as {
    access_token?: unknown;
    instance_url?: unknown;
    error?: unknown;
    error_description?: unknown;
  } | null;
  if (res.ok && typeof body?.access_token === 'string' && typeof body.instance_url === 'string') {
    const instance = normalizeInstanceUrl(body.instance_url);
    if (instance) return { ok: true, accessToken: body.access_token, instanceUrl: instance };
    return { ok: false, reason: 'rejected' };
  }
  if (res.status >= 500 || res.status === 429) {
    throw new Error(`salesforce token endpoint answered HTTP ${res.status}`);
  }
  const error = typeof body?.error === 'string' ? body.error : '';
  const description = typeof body?.error_description === 'string' ? body.error_description.toLowerCase() : '';
  if (description.includes('client credentials user')) return { ok: false, reason: 'no_run_as' };
  if (error.startsWith('invalid_client')) return { ok: false, reason: 'invalid_client' };
  return { ok: false, reason: 'rejected' };
}

/**
 * The instance URL the token is good for, accepted only on a Salesforce host:
 * it is where every later request, token included, is sent.
 */
function normalizeInstanceUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (!/\.(salesforce|force)\.com$/.test(host)) return null;
    return `https://${host}`;
  } catch {
    return null;
  }
}

/** The org's display name, for the connections card. Null when it cannot be read. */
export async function readOrgName(
  token: { accessToken: string; instanceUrl: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const q = encodeURIComponent('SELECT Name FROM Organization LIMIT 1');
    const res = await fetchImpl(
      `${token.instanceUrl}/services/data/${SALESFORCE_API_VERSION}/query?q=${q}`,
      {
        headers: { authorization: `Bearer ${token.accessToken}`, accept: 'application/json' },
        signal: AbortSignal.timeout(SALESFORCE_AUTH_TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { records?: Array<{ Name?: unknown }> } | null;
    const name = body?.records?.[0]?.Name;
    return typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : null;
  } catch {
    return null;
  }
}

/** The tail shown on the card: the consumer key's, never the secret's. */
export function salesforceLast4(creds: SalesforceCredentials): string {
  return creds.consumerKey.slice(-4);
}

export interface SalesforceAccess {
  accessToken: string;
  instanceUrl: string;
}

/**
 * ONE instance app-wide, shared by the controller (probe, field picker) and
 * the delivery path, so a disconnect clears the one cache both of them read.
 */
@Injectable()
export class SalesforceAccessTokens {
  private readonly cache = new Map<string, SalesforceAccess & { expires: number }>();

  /** The account's stored connection, decrypted and parsed, or null. */
  async credentials(db: Db, accountId: string, env: ServerEnv | undefined): Promise<SalesforceCredentials | null> {
    const stored = await resolveProviderToken(db, accountId, 'salesforce', env?.FORMS_ENCRYPTION_KEY, undefined);
    return parseSalesforceCredentials(stored);
  }

  /**
   * A live token and instance URL for the account, or null when there is none
   * to be had (not connected, or the org refused). Throws when Salesforce did
   * not answer, so a delivery is retried rather than dropped.
   */
  async resolve(
    db: Db,
    accountId: string,
    env: ServerEnv | undefined,
    fetchImpl: typeof fetch = fetch,
    now: number = Date.now(),
  ): Promise<SalesforceAccess | null> {
    const hit = this.cache.get(accountId);
    if (hit && hit.expires > now) return { accessToken: hit.accessToken, instanceUrl: hit.instanceUrl };
    const creds = await this.credentials(db, accountId, env);
    if (!creds) return null;
    const minted = await mintSalesforceToken(creds, fetchImpl);
    if (!minted.ok) {
      this.cache.delete(accountId);
      return null;
    }
    this.cache.set(accountId, {
      accessToken: minted.accessToken,
      instanceUrl: minted.instanceUrl,
      expires: now + SALESFORCE_TOKEN_CACHE_MS,
    });
    return { accessToken: minted.accessToken, instanceUrl: minted.instanceUrl };
  }

  /** Forget the account's token (a reconnect, a disconnect, a 401). */
  invalidate(accountId: string): void {
    this.cache.delete(accountId);
  }
}
