import { Inject, Injectable, Logger } from '@nestjs/common';
import { enqueueOutbox, type Db } from '@quill/db';
import type { ServerEnv } from '@quill/config/env';
import { DB, ENV } from './tokens';

/**
 * The durable payload an `analytics` outbox row carries: one product-analytics
 * event about a person who USES Dapta Forms.
 *
 * Deliberately small and PII-light. `distinctId` is the member's email — the
 * same identifier the rest of the Dapta estate identifies people by, so a user
 * who arrives from the Dapta admin panel is ONE person and not two. Beyond that
 * identifier, nothing personal is serialized here: no answers, no respondent
 * data, no secrets. A form's respondents are NOT users of this product and are
 * never captured.
 */
export interface AnalyticsEventPayload {
  /** Event name. Always `forms_`-prefixed — see AnalyticsEffects.capture. */
  event: string;
  /** Who the event is about: the member's email. */
  distinctId: string;
  /** Free-form event properties. Keep them small, flat, and free of PII. */
  properties?: Record<string, string | number | boolean | null>;
  /** The account the event belongs to; becomes the `forms_account` group. */
  accountId: string | null;
  /** Epoch-ms the event actually happened — NOT when the row is drained. */
  timestamp: number;
}

/**
 * Every event name this product emits carries this prefix.
 *
 * Product analytics ships into a PostHog project SHARED with the rest of Dapta,
 * so an unprefixed `activation` or `signup_completed` would collide with
 * another product's event of the same name and silently merge two different
 * things into one funnel. The prefix is applied centrally in `capture()` rather
 * than trusted to each call site.
 */
const EVENT_PREFIX = 'forms_';

/**
 * Durable PRODUCT ANALYTICS enqueue (mirrors EmailEffects / BookingEffects).
 *
 * Every event is ENQUEUED as an `outbox` row (kind `analytics`) and drained
 * later by the worker with retry + backoff — never sent inline. Two reasons,
 * both load-bearing:
 *
 *  1. Invariant 5: a capture is a network call, and the most important event
 *     (activation) fires on the public submission path. An inline call to a
 *     slow or down analytics vendor would delay — or fail — a respondent's
 *     submission, which is the single most critical request in the product.
 *  2. Analytics is best-effort but should not be lossy: the outbox already
 *     gives retry, backoff and a durable record, for free.
 *
 * When `PRODUCT_ANALYTICS_KEY` is unset (the default, and the state of any bare
 * fork) this enqueues NOTHING. Not a queued row that fails later — nothing at
 * all, so the outbox never fills with undeliverable work on a deployment that
 * simply does not use analytics.
 */
@Injectable()
export class AnalyticsEffects {
  private readonly log = new Logger('AnalyticsEffects');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  /** True when this deployment has product analytics configured at all. */
  get enabled(): boolean {
    return Boolean(this.env.PRODUCT_ANALYTICS_KEY);
  }

  /**
   * Enqueue one product-analytics event.
   *
   * NEVER REJECTS. Analytics is an observer of the product, never a
   * participant: no user-facing action may fail because telemetry could not be
   * recorded. Callers may `void` this safely.
   *
   * `event` is passed WITHOUT the `forms_` prefix; it is added here.
   */
  async capture(
    event: string,
    input: {
      distinctId: string;
      accountId: string | null;
      properties?: Record<string, string | number | boolean | null>;
    },
    now: number = Date.now(),
  ): Promise<void> {
    if (!this.enabled) return;
    try {
      const payload: AnalyticsEventPayload = {
        event: `${EVENT_PREFIX}${event}`,
        distinctId: input.distinctId,
        properties: input.properties,
        accountId: input.accountId,
        // Stamped at ENQUEUE time. The row may be drained seconds or minutes
        // later (or retried for much longer); sending the drain time would
        // smear the funnel and put events out of order.
        timestamp: now,
      };
      await enqueueOutbox(this.db, {
        kind: 'analytics',
        action: payload.event,
        accountId: input.accountId,
        payload: JSON.stringify(payload),
        now,
      });
    } catch (err) {
      this.log.error(`failed to enqueue analytics event ${event}: ${String(err)}`);
    }
  }
}
