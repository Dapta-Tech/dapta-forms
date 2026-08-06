import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ServerEnv } from '@quill/config/env';
import { ENV } from './tokens';
import { OutboxSkipError } from './email-effects';
import type { AnalyticsEventPayload } from './analytics-effects';

/**
 * The vendor's ingestion endpoint, relative to the configured host. PostHog's
 * `/capture/` accepts one event as a plain JSON POST with the write-only
 * project key in the body — no SDK, no auth header, no server secret.
 */
const CAPTURE_PATH = '/capture/';

/** Give up on a hung vendor rather than holding a worker slot indefinitely. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Worker-side delivery of a product-analytics event (`analytics` outbox rows).
 *
 * Failure policy mirrors BookingSyncEffects, because the outbox reads it the
 * same way:
 *   - TRANSIENT (network error, timeout, HTTP 429/5xx) -> throw, so the worker
 *     retries with exponential backoff.
 *   - PERMANENT (no key configured, HTTP 4xx — a malformed event or a revoked
 *     key) -> throw OutboxSkipError, so the row is recorded `skipped` ONCE with
 *     the reason and never retried. Retrying a 400 forever would burn the queue
 *     on an event that can never be accepted.
 *
 * With no key configured this skips instead of failing: a fork that removes its
 * key mid-flight drains whatever was already queued into `skipped` rows and
 * moves on, rather than accumulating permanent failures.
 */
@Injectable()
export class AnalyticsCapture {
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl: typeof fetch = fetch;

  constructor(@Optional() @Inject(ENV) private readonly env?: ServerEnv) {}

  /** The worker's executor for an `analytics` outbox row. */
  async deliver(_action: string, payloadJson: string): Promise<void> {
    const key = this.env?.PRODUCT_ANALYTICS_KEY;
    if (!key) {
      throw new OutboxSkipError('analytics: PRODUCT_ANALYTICS_KEY is not configured');
    }
    const payload = JSON.parse(payloadJson) as AnalyticsEventPayload;
    const host = (this.env?.PRODUCT_ANALYTICS_HOST ?? 'https://us.i.posthog.com').replace(
      /\/+$/,
      '',
    );

    const body = {
      api_key: key,
      event: payload.event,
      distinct_id: payload.distinctId,
      // The vendor reads `timestamp` as when the event HAPPENED, which is what
      // the payload carries (enqueue time), not when this row drained.
      timestamp: new Date(payload.timestamp).toISOString(),
      properties: {
        ...(payload.properties ?? {}),
        // Super property, server side. The browser sets the same key via
        // posthog.register(); setting it here too means an event is tagged as
        // ours no matter which half of the app emitted it. Without this, our
        // telemetry is indistinguishable from the rest of the Dapta estate's in
        // the shared project.
        product: 'forms',
        // Account-level grouping: activation is a property of a WORKSPACE, not
        // of a person, so "how many accounts activated" has to be answerable
        // without deduplicating members by hand. `forms_account` (not `account`)
        // keeps our id space from colliding with another Dapta product's.
        ...(payload.accountId ? { $groups: { forms_account: payload.accountId } } : {}),
      },
    };

    let res: Response;
    try {
      res = await this.fetchImpl(`${host}${CAPTURE_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Network-level: unreachable, DNS, TLS, timeout. All transient.
      throw new Error(`analytics capture failed: ${String(err)}`);
    }

    if (res.ok) return;

    // 429 and 5xx are the vendor's "try again"; everything else in 4xx is a
    // rejection that will be rejected identically forever.
    if (res.status === 429 || res.status >= 500) {
      throw new Error(`analytics capture failed: HTTP ${res.status}`);
    }
    throw new OutboxSkipError(
      `analytics: vendor rejected event ${payload.event} with HTTP ${res.status}`,
    );
  }
}
