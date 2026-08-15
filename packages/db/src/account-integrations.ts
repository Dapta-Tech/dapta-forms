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
import { encryptToken, decryptToken, tokenLast4 } from './crypto';

export const integrationProviders = ['hubspot', 'calendly'] as const;
export type IntegrationProvider = (typeof integrationProviders)[number];

export interface IntegrationMeta {
  /** Last 4 chars of the token, for display. */
  last4?: string;
  /** A human label for the connected account (e.g. hub id / connected email). */
  label?: string;
  [k: string]: unknown;
}

export interface IntegrationRow {
  id: string;
  accountId: string;
  provider: IntegrationProvider;
  encryptedToken: string;
  meta: IntegrationMeta | null;
  connectedAt: number;
  updatedAt: number;
}

const providerCredentialRevisionBrand: unique symbol = Symbol('ProviderCredentialRevision');

/**
 * Non-secret identity for the source of a resolved provider credential.
 *
 * A stored credential pairs its durable row id with its monotonically updated
 * timestamp. The env fallback uses a stable sentinel because it has no
 * account-row revision. The private brand prevents credential strings from
 * entering callers that accept only revisions.
 */
export type ProviderCredentialRevision =
  | {
      readonly kind: 'stored';
      readonly id: string;
      readonly updatedAt: number;
      readonly [providerCredentialRevisionBrand]: true;
    }
  | {
      readonly kind: 'env-fallback';
      readonly [providerCredentialRevisionBrand]: true;
    };

/** The live provider token paired with its non-secret source revision. */
export interface ResolvedProviderToken {
  token: string;
  revision: ProviderCredentialRevision;
}

const ENV_FALLBACK_REVISION: ProviderCredentialRevision = {
  kind: 'env-fallback',
  [providerCredentialRevisionBrand]: true,
};

function storedCredentialRevision(row: IntegrationRow): ProviderCredentialRevision {
  return {
    kind: 'stored',
    id: row.id,
    updatedAt: row.updatedAt,
    [providerCredentialRevisionBrand]: true,
  };
}

/** Compare opaque, non-secret credential source revisions across API instances. */
export function providerCredentialRevisionEquals(
  a: ProviderCredentialRevision,
  b: ProviderCredentialRevision,
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'env-fallback' || b.kind === 'env-fallback') return true;
  return a.id === b.id && a.updatedAt === b.updatedAt;
}

/** Public, token-free view of a connection for the connections UI. */
export interface IntegrationStatus {
  provider: IntegrationProvider;
  connected: true;
  last4: string | null;
  label: string | null;
  connectedAt: number;
}

function mapRow(r: Record<string, unknown>): IntegrationRow {
  return {
    id: String(r.id),
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
  return {
    provider: row.provider,
    connected: true,
    last4: row.meta?.last4 ?? null,
    label: row.meta?.label ?? null,
    connectedAt: row.connectedAt,
  };
}

/** Fetch the raw row (incl. ciphertext) for one provider, or null. */
export async function getIntegration(
  db: Db,
  accountId: string,
  provider: IntegrationProvider,
): Promise<IntegrationRow | null> {
  const r = await db.get<Record<string, unknown>>(
    sql`SELECT id, account_id, provider, encrypted_token, meta, connected_at, updated_at
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
    sql`SELECT id, account_id, provider, encrypted_token, meta, connected_at, updated_at
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
): Promise<IntegrationStatus> {
  const meta: IntegrationMeta = { last4: tokenLast4(token) };
  if (label) meta.label = label;
  const encrypted = encryptToken(token, encryptionKey);
  const existing = await getIntegration(db, accountId, provider);
  // `updated_at` is the persistent cache revision. Advance it even when two
  // successful reconnects share a millisecond, so every mutation is visible.
  const now = Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1);
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
 * if connected, else the single-tenant env fallback. Pairs the token with a
 * non-secret source revision so in-process caches can self-heal across API
 * instances. Returns null when neither is available. `encryptionKey` may be
 * empty (then only the env fallback is consulted). This is the one function
 * the delivery/read sites call.
 */
export async function resolveProviderToken(
  db: Db,
  accountId: string,
  provider: IntegrationProvider,
  encryptionKey: string | undefined,
  envFallback: string | undefined,
): Promise<ResolvedProviderToken | null> {
  if (encryptionKey) {
    const row = await getIntegration(db, accountId, provider);
    if (row) {
      try {
        return {
          token: decryptToken(row.encryptedToken, encryptionKey),
          revision: storedCredentialRevision(row),
        };
      } catch {
        // A key rotation / corrupt row must not crash delivery — fall through
        // to the env fallback and let the caller degrade (log-only).
      }
    }
  }
  const token = envFallback?.trim();
  return token ? { token, revision: ENV_FALLBACK_REVISION } : null;
}
