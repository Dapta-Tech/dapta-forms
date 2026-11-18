/**
 * Account-level integration credentials (paste-token model).
 *
 * One row per (account, provider). The token is stored ENCRYPTED (AES-256-GCM,
 * see crypto.ts) — the plaintext is supplied by the caller (the API layer, which
 * owns FORMS_ENCRYPTION_KEY) and never persisted. `meta` holds only non-secret
 * display hints (token last4, a connected-account label). Read paths that need
 * the live token pass the key in and get the decrypted value back; everything
 * user-facing goes through `describeIntegration` which never exposes the token.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { parseJsonColumn, jsonParam } from './forms';
import type { GoHighLevelStatusExtras } from '@quill/types';
import { encryptToken, decryptToken, tokenLast4 } from './crypto';

/**
 * `google-sheets` is the one provider whose stored token is not pasted by the
 * operator: it is the OAuth REFRESH TOKEN the Google consent flow handed back,
 * and the client id and secret that redeem it stay in the deployment's env
 * rather than in this table. So the storage contract is unchanged (one opaque
 * secret string per account, encrypted), and `tokenLast4` still shows the tail
 * of a real credential.
 *
 * `salesforce` stores a JSON object rather than a bare token, because a Client
 * Credentials connection is three values that only work together: the org's My
 * Domain, the consumer key and the consumer secret. It is still ONE encrypted
 * string per account, so the storage contract holds; the caller passes the
 * `last4` to show, since the tail of a JSON string is a closing brace.
 *
 * `gohighlevel` stores JSON too (the Private Integration token and the
 * Location ID). Its `meta` also carries the `locationId` to show and, once a
 * delivery got a 401 or 403 for that token, `rejectedAt`; a reconnect writes
 * `meta` afresh, which clears it.
 */
export const integrationProviders = ['hubspot', 'calendly', 'google-sheets', 'salesforce', 'gohighlevel'] as const;
export type IntegrationProvider = (typeof integrationProviders)[number];

export interface IntegrationMeta {
  /** Last 4 chars of the token, for display. */
  last4?: string;
  /** A human label for the connected account (e.g. hub id / connected email). */
  label?: string;
  [k: string]: unknown;
}

export interface IntegrationRow {
  accountId: string;
  provider: IntegrationProvider;
  encryptedToken: string;
  meta: IntegrationMeta | null;
  connectedAt: number;
  updatedAt: number;
}

/**
 * Public, token-free view of a connection for the connections UI. The
 * HighLevel extras (`locationId`, `rejectedAt`) are present on a `gohighlevel`
 * entry only.
 */
export interface IntegrationStatus extends Partial<GoHighLevelStatusExtras> {
  provider: IntegrationProvider;
  connected: true;
  last4: string | null;
  label: string | null;
  connectedAt: number;
}

function mapRow(r: Record<string, unknown>): IntegrationRow {
  return {
    accountId: String(r.account_id),
    provider: String(r.provider) as IntegrationProvider,
    encryptedToken: String(r.encrypted_token),
    meta: r.meta == null ? null : parseJsonColumn<IntegrationMeta | null>(r.meta, null),
    connectedAt: Number(r.connected_at),
    updatedAt: Number(r.updated_at),
  };
}

/** Never leaks the token — safe to return to the browser. */
export function describeIntegration(row: IntegrationRow): IntegrationStatus {
  const status: IntegrationStatus = {
    provider: row.provider,
    connected: true,
    last4: row.meta?.last4 ?? null,
    label: row.meta?.label ?? null,
    connectedAt: row.connectedAt,
  };
  if (row.provider === 'gohighlevel') {
    const { locationId, rejectedAt } = row.meta ?? {};
    status.locationId = typeof locationId === 'string' && locationId ? locationId : null;
    status.rejectedAt = typeof rejectedAt === 'number' && Number.isFinite(rejectedAt) ? rejectedAt : null;
  }
  return status;
}

/** Fetch the raw row (incl. ciphertext) for one provider, or null. */
export async function getIntegration(
  db: Db,
  accountId: string,
  provider: IntegrationProvider,
): Promise<IntegrationRow | null> {
  const r = await db.get<Record<string, unknown>>(
    sql`SELECT account_id, provider, encrypted_token, meta, connected_at, updated_at
        FROM account_integration WHERE account_id = ${accountId} AND provider = ${provider} LIMIT 1`,
  );
  return r ? mapRow(r) : null;
}

/** All connections for an account, token-free, for the connections page. */
export async function listIntegrationStatuses(
  db: Db,
  accountId: string,
): Promise<IntegrationStatus[]> {
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT account_id, provider, encrypted_token, meta, connected_at, updated_at
        FROM account_integration WHERE account_id = ${accountId}`,
  );
  return rows.map((r) => describeIntegration(mapRow(r)));
}

/**
 * Connect (or re-connect) a provider: encrypt the pasted token and upsert.
 * `label` is an optional non-secret display hint resolved by the caller after
 * validating the token against the provider. Returns the token-free status.
 */
export async function upsertIntegration(
  db: Db,
  accountId: string,
  provider: IntegrationProvider,
  token: string,
  encryptionKey: string,
  label?: string | null,
  /** Override the displayed tail when `token` is not itself the credential. */
  last4?: string,
  /**
   * Other non-secret display hints (HighLevel's `locationId`). `meta` is
   * written whole, so anything not passed again (a `rejectedAt`) is cleared.
   */
  extraMeta?: Record<string, string | number>,
): Promise<IntegrationStatus> {
  const meta: IntegrationMeta = { ...extraMeta, last4: last4 ?? tokenLast4(token) };
  if (label) meta.label = label;
  const encrypted = encryptToken(token, encryptionKey);
  const now = Date.now();
  const existing = await getIntegration(db, accountId, provider);
  if (existing) {
    await db.run(
      sql`UPDATE account_integration
          SET encrypted_token = ${encrypted}, meta = ${jsonParam(meta)}, updated_at = ${now}
          WHERE account_id = ${accountId} AND provider = ${provider}`,
    );
  } else {
    await db.run(
      sql`INSERT INTO account_integration (id, account_id, provider, encrypted_token, meta, connected_at, updated_at)
          VALUES (${randomUUID()}, ${accountId}, ${provider}, ${encrypted}, ${jsonParam(meta)}, ${now}, ${now})`,
    );
  }
  const row = await getIntegration(db, accountId, provider);
  return describeIntegration(row!);
}

/**
 * Record that the provider refused the stored credential (epoch ms), for the
 * connections card. Written only while the row still holds `encryptedToken`,
 * the credential the refused delivery used: a delivery that read the old
 * token and answered after a reconnect must not mark the new one. The
 * ciphertext is the guard because every encryption has its own IV, so a
 * reconnect with the very same token still changes it. Returns whether the
 * mark is on that credential afterwards (read back, since a reconnect can land
 * between the read and the write). Leaves `updated_at` alone: nothing about
 * the connection itself changed.
 */
export async function markIntegrationRejected(
  db: Db,
  accountId: string,
  provider: IntegrationProvider,
  encryptedToken: string,
  at: number = Date.now(),
): Promise<boolean> {
  const row = await getIntegration(db, accountId, provider);
  if (!row || row.encryptedToken !== encryptedToken) return false;
  const meta: IntegrationMeta = { ...(row.meta ?? {}), rejectedAt: at };
  await db.run(
    sql`UPDATE account_integration SET meta = ${jsonParam(meta)}
        WHERE account_id = ${accountId} AND provider = ${provider} AND encrypted_token = ${encryptedToken}`,
  );
  const after = await getIntegration(db, accountId, provider);
  return after?.encryptedToken === encryptedToken && typeof after.meta?.rejectedAt === 'number';
}

/** Disconnect a provider. Idempotent. */
export async function deleteIntegration(
  db: Db,
  accountId: string,
  provider: IntegrationProvider,
): Promise<void> {
  await db.run(
    sql`DELETE FROM account_integration WHERE account_id = ${accountId} AND provider = ${provider}`,
  );
}

/**
 * Resolve the live token for a provider: the account's stored (decrypted) token
 * if connected, else the single-tenant env fallback. Returns null when neither
 * is available. `encryptionKey` may be empty (then only the env fallback is
 * consulted). This is the one function the 4 delivery/read sites call.
 */
export async function resolveProviderToken(
  db: Db,
  accountId: string,
  provider: IntegrationProvider,
  encryptionKey: string | undefined,
  envFallback: string | undefined,
): Promise<string | null> {
  if (encryptionKey) {
    const row = await getIntegration(db, accountId, provider);
    if (row) {
      try {
        return decryptToken(row.encryptedToken, encryptionKey);
      } catch {
        // A key rotation / corrupt row must not crash delivery — fall through
        // to the env fallback and let the caller degrade (log-only).
      }
    }
  }
  return envFallback && envFallback.trim() ? envFallback.trim() : null;
}
