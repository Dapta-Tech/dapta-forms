import { Inject, Injectable, Logger } from '@nestjs/common';
import { enqueueOutbox, getNotificationSettings, sql, type Db } from '@quill/db';
import {
  SubmissionNotifier,
  type EmailProvider,
  type SubmissionNotification,
} from '@quill/notifications';
import type { ServerEnv } from '@quill/config/env';
import { DB, EMAIL, ENV, NOTIFIER } from './tokens';

/**
 * Thrown by `deliver` when a row must be deliberately NOT sent (e.g. tenant
 * context unrecoverable on a transport that requires it). The worker marks the
 * row `skipped` ONCE with this reason — it never burns the retry schedule.
 */
export class OutboxSkipError extends Error {}

/** The submission emails the outbox can carry. */
export type EmailKind = 'submission_received' | 'submission_confirmed';

/**
 * Durable submission emails (B1 / audit DM1). Every notification is ENQUEUED as
 * an `outbox` row (kind `email`) instead of fire-and-forget; the OutboxWorker
 * drains it with retry+backoff, so an SMTP blip or a process restart never
 * silently drops a submission email — it retries and leaves a delivery-log
 * record. The `log-only` default provider resolves success (a no-op log), so a
 * bare clone never accumulates failed rows.
 */
@Injectable()
export class EmailEffects {
  private readonly log = new Logger('EmailEffects');

  constructor(
    @Inject(NOTIFIER) private readonly notifier: SubmissionNotifier,
    @Inject(DB) private readonly db: Db,
    @Inject(EMAIL) private readonly provider?: EmailProvider,
    @Inject(ENV) private readonly env?: ServerEnv,
  ) {}

  /** Never rejects — the caller fire-and-forgets with `void`. */
  async enqueueSubmissionReceived(
    accountId: string,
    n: Omit<SubmissionNotification, 'accountId' | 'to'> & { to?: string[] },
  ): Promise<void> {
    try {
      // The account-side notice goes to the owner inbox; a fork with no member
      // email just carries no recipient and the notifier no-ops on empty `to`.
      // The owner's `locale` selects the EN/ES copy (absent = English default).
      const owner = await this.db.get<{ email: string | null; locale: string | null }>(
        sql`SELECT email, locale FROM member
            WHERE account_id = ${accountId} AND role = 'owner' AND status = 'active'
            ORDER BY created_at ASC LIMIT 1`,
      );
      const to = n.to ?? (owner?.email ? [owner.email] : []);
      // Snapshot the toggle: absent row = enabled (fork-friendly default).
      const settings = await getNotificationSettings(this.db, accountId);
      if (settings.get('submission_received')?.enabled === false) return;
      const payload: SubmissionNotification = {
        ...n,
        accountId,
        to,
        locale: n.locale ?? owner?.locale ?? null,
      };
      await enqueueOutbox(this.db, {
        kind: 'email',
        action: 'submission_received',
        accountId,
        payload: JSON.stringify(payload),
      });
    } catch (err) {
      this.log.error(`failed to enqueue submission_received: ${String(err)}`);
    }
  }

  /**
   * The worker's executor for an `email` outbox row. Rebuilds the notification
   * from the payload and sends it; a THROWN transport error propagates so the
   * worker retries. A missing tenant on a transport that requires it is a
   * DECISION (skip), not a failure.
   */
  async deliver(action: string, payloadJson: string, outboxAccountId?: string | null): Promise<void> {
    const n = JSON.parse(payloadJson) as SubmissionNotification;
    if (!n.accountId && outboxAccountId) n.accountId = outboxAccountId;
    if (!n.accountId && this.provider?.requiresAccountContext) {
      throw new OutboxSkipError(
        'email outbox row missing account context — skipped (signed transport requires a tenant)',
      );
    }
    switch (action) {
      case 'submission_received':
        await this.notifier.sendSubmissionReceived(n);
        return;
      case 'submission_confirmed':
        await this.notifier.sendSubmissionConfirmed(n);
        return;
      default:
        throw new Error(`unknown email action: ${action}`);
    }
  }
}
