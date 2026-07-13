/**
 * Entitlements PORT — "is this account a paying Dapta AI customer?"
 *
 * Dapta Forms is ALWAYS free: there is no Forms-side plan or billing,
 * ever. Premium unlocks (vanity slug, future perks) come with the customer's
 * Dapta AI subscription, validated against the upstream entitlement service.
 * Open-core split (public port, private adapter):
 *   - OSS default: DisabledEntitlementsProvider (no upstream wired). Combined
 *     with `PREMIUM_FEATURES=open` (the default) forks get premium features
 *     unlocked — we don't upsell forks, they just don't get cloud entitlements.
 *   - Cloud: HttpEntitlementsProvider + `PREMIUM_FEATURES=locked` gates on the
 *     upstream verdict, which the caller caches on the account row (TTL) so
 *     public paths never block on the upstream service.
 */
import type { ServerEnv } from '@quill/config/env';

export interface EntitlementKeys {
  /** The account owner's email (the upstream service resolves customers by owner email). */
  ownerEmail?: string | null;
  /** The account's upstream org/tenant id, when a deployment maps ids directly. */
  externalOrgId?: string | null;
}

export interface EntitlementsProvider {
  /** True when a real upstream is wired; false = OSS default. */
  readonly enabled: boolean;
  /** Live verdict from the source of truth. Never cache here — the caller does. */
  isPaidCustomer(keys: EntitlementKeys): Promise<boolean>;
}

/** OSS default: no upstream. `PREMIUM_FEATURES=open` (default) makes the gate moot. */
export class DisabledEntitlementsProvider implements EntitlementsProvider {
  readonly enabled = false;
  isPaidCustomer(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

/**
 * Upstream account statuses that count as PAYING. 2 = paid; 5/6 are grace
 * states (cancel-at-period-end, past-due) that retain access until period end.
 */
const PAYING_STATUS_IDS = new Set([2, 5, 6]);

/**
 * Generic HTTP adapter for the upstream entitlement service. Contract:
 *   GET {base}/account/search/admin?owner_email=… with `x-api-key` service
 *   auth → [{ account_status_id, … }]. Diagnostic by design: any failure or
 *   ambiguity returns `false` (the claim can be retried; nothing user-facing
 *   breaks) — never throws.
 */
export class HttpEntitlementsProvider implements EntitlementsProvider {
  readonly enabled = true;
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs = 10_000,
  ) {}

  async isPaidCustomer(keys: EntitlementKeys): Promise<boolean> {
    if (!keys.ownerEmail) return false;
    try {
      const url = new URL(`${this.baseUrl.replace(/\/$/, '')}/account/search/admin`);
      url.searchParams.set('owner_email', keys.ownerEmail);
      const res = await fetch(url, {
        headers: { 'x-api-key': this.apiKey },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return false;
      const body = (await res.json().catch(() => null)) as unknown;
      const rows = Array.isArray(body)
        ? body
        : Array.isArray((body as { data?: unknown[] })?.data)
          ? (body as { data: unknown[] }).data
          : [];
      return rows.some(
        (r) => PAYING_STATUS_IDS.has(Number((r as { account_status_id?: unknown }).account_status_id)),
      );
    } catch {
      return false;
    }
  }
}

/** Env-driven selection (disabled unless the upstream service is configured). */
export function resolveEntitlementsProvider(
  env: Pick<ServerEnv, 'ENTITLEMENTS_API_URL' | 'ENTITLEMENTS_API_KEY'>,
): EntitlementsProvider {
  if (env.ENTITLEMENTS_API_URL && env.ENTITLEMENTS_API_KEY) {
    return new HttpEntitlementsProvider(env.ENTITLEMENTS_API_URL, env.ENTITLEMENTS_API_KEY);
  }
  return new DisabledEntitlementsProvider();
}
