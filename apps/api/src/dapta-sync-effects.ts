import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { enqueueOutbox, type Db } from '@quill/db';
import type { ServerEnv } from '@quill/config/env';
import { DB, ENV } from './tokens';

/**
 * The durable payload a `dapta_sync` outbox row carries. Deliberately just the
 * two principal ids: everything else — the member's email and external id, the
 * onboarding answers, the account's attribution — is read FRESH at delivery
 * time. A row can sit through minutes of retries, and during that window the
 * person may answer more questions; serializing answers here would deliver a
 * stale snapshot when the whole point is that the CRM reflects what was
 * actually answered.
 */
export interface DaptaSyncPayload {
  accountId: string;
  memberId: string;
}

/** The two moments Forms pushes into the Dapta estate. */
export type DaptaSyncAction = 'early' | 'complete';

/**
 * Durable enqueue of the Dapta-estate sync (mirrors AnalyticsEffects).
 *
 * `early` fires when the wizard's FIRST answer lands, so the person exists in
 * HubSpot (email + phone + campaign tags) even if they abandon the wizard —
 * the same reason Dapta's own admin panel calls the sync flow from its first
 * onboarding screen. `complete` fires when the completion claim is won: the
 * delivery writes the mappable answers to the IAM and then calls the flow,
 * which pulls them (plus the computed lead score) into the HubSpot contact.
 *
 * Never called inline (invariant 5): both deliveries are network calls into
 * another team's infrastructure, and neither a wizard PATCH nor the completion
 * request may fail or slow down because that infrastructure is down. When the
 * flow env is unset (any OSS fork, and any environment where the feature is
 * not configured yet) this enqueues NOTHING — not a row that fails later.
 */
@Injectable()
export class DaptaSyncEffects {
  private readonly log = new Logger('DaptaSyncEffects');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Optional() @Inject(ENV) private readonly env?: ServerEnv,
  ) {}

  /** True when this deployment can reach the Dapta contact-sync flow at all. */
  get enabled(): boolean {
    return Boolean(this.env?.DAPTA_SYNC_FLOW_URL && this.env?.DAPTA_SYNC_FLOW_KEY);
  }

  /**
   * Enqueue one sync moment. NEVER REJECTS — the sync is an observer of
   * onboarding, not a participant, so callers `void` this safely.
   */
  private async enqueue(
    action: DaptaSyncAction,
    accountId: string,
    memberId: string,
  ): Promise<void> {
    if (!this.enabled) return;
    try {
      const payload: DaptaSyncPayload = { accountId, memberId };
      await enqueueOutbox(this.db, {
        kind: 'dapta_sync',
        action,
        subjectUid: accountId,
        accountId,
        payload: JSON.stringify(payload),
      });
    } catch (err) {
      this.log.error(`failed to enqueue dapta_sync ${action}: ${String(err)}`);
    }
  }

  /** The wizard's first answer just landed — make the contact exist. */
  async enqueueEarly(accountId: string, memberId: string): Promise<void> {
    await this.enqueue('early', accountId, memberId);
  }

  /** The completion claim was won — push answers + score to the estate. */
  async enqueueComplete(accountId: string, memberId: string): Promise<void> {
    await this.enqueue('complete', accountId, memberId);
  }
}
