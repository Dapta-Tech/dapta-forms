/**
 * The access token a Google Sheets delivery writes with.
 *
 * What is stored per account is a refresh token, which Google will not accept
 * as a credential; what a delivery needs is an access token, which lives about
 * an hour. This sits between the two, and it is a cache for one reason: an
 * outbox lane can drain a burst of submissions for the same account in seconds,
 * and minting a token per row would spend the account's own Google quota on
 * nothing but tokens.
 *
 * The two failure modes are kept apart on purpose, because the outbox treats
 * them in opposite ways:
 *
 *   - Google REFUSED the refresh (the grant was revoked, the client rotated,
 *     the token went unused for months). That answer will not change, so this
 *     returns an empty token, the factory degrades to log-only, and the
 *     delivery is marked done with a reason the author can read. Retrying a
 *     refused grant is how an integration hammers a provider for a week.
 *   - Nothing ANSWERED (a dead socket, a timeout). That throws, so the delivery
 *     fails and the outbox's backoff gets its turn.
 */
import { resolveProviderToken, type Db } from '@quill/db';
import type { ServerEnv } from '@quill/config/env';
import { googleOAuthClient, refreshGoogleAccessToken } from './google-oauth';

/**
 * Renew this long before Google's own expiry.
 *
 * Load-bearing rather than tidy: a delivery that starts with a token about to
 * expire gets a 401, and this adapter treats a 401 as PERMANENT (it is handed a
 * fresh token per delivery, so a refusal means the grant is bad). Without a
 * margin, a submission landing in the last seconds of a token's life would be
 * dropped and reported as a revoked connection.
 */
export const GOOGLE_TOKEN_RENEW_MARGIN_MS = 120_000;

/** Never trust a long expiry: re-mint at least this often regardless. */
export const GOOGLE_TOKEN_MAX_CACHE_MS = 50 * 60_000;

export class GoogleSheetsAccessTokens {
  private readonly cache = new Map<string, { token: string; expires: number }>();

  /**
   * A live access token for the account, or `''` when there is none to be had.
   *
   * Empty covers every permanent reason, and they are not distinguished here on
   * purpose: the factory turns all of them into a log-only no-op with its own
   * sentence, and the distinctions that matter to an author (not connected,
   * access revoked) are visible on the connections page rather than in a
   * delivery row.
   */
  async resolve(
    db: Db,
    accountId: string,
    env: ServerEnv | undefined,
    fetchImpl: typeof fetch = fetch,
    now: number = Date.now(),
  ): Promise<string> {
    const hit = this.cache.get(accountId);
    if (hit && hit.expires > now) return hit.token;

    const client = googleOAuthClient(env);
    if (!client) return '';

    // No env fallback, unlike HubSpot: a refresh token belongs to one account's
    // own Google grant, so there is no deployment-wide one to fall back to.
    const refreshToken = await resolveProviderToken(
      db,
      accountId,
      'google-sheets',
      env?.FORMS_ENCRYPTION_KEY,
      undefined,
    );
    if (!refreshToken) return '';

    // Throws on a transport failure, which is what we want: the outbox retries.
    const minted = await refreshGoogleAccessToken(client, refreshToken, fetchImpl);
    if (!minted) {
      // Refused. Drop any cached token for this account too: whatever is in
      // there is from a grant Google has stopped honouring.
      this.cache.delete(accountId);
      return '';
    }

    const lifetimeMs = Math.max(0, minted.expiresInSec * 1000 - GOOGLE_TOKEN_RENEW_MARGIN_MS);
    this.cache.set(accountId, {
      token: minted.accessToken,
      expires: now + Math.min(lifetimeMs, GOOGLE_TOKEN_MAX_CACHE_MS),
    });
    return minted.accessToken;
  }

  /** Forget the account's token (a reconnect, a disconnect). */
  invalidate(accountId: string): void {
    this.cache.delete(accountId);
  }
}
