import { Inject, Injectable, Logger } from '@nestjs/common';
import { enqueueOutbox, getNotificationSettings, sql, type Db } from '@quill/db';
import {
  SubmissionNotifier,
  type EmailProvider,
  type MemberInvitedNotification,
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

/** One email's effective toggle + copy after the form → account → stock merge. */
interface ResolvedEmailSetting {
  enabled: boolean;
  /** NULL = stock template (nothing to snapshot). */
  subject: string | null;
  body: string | null;
}

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

  /**
   * Merge one email's settings across the three layers, PER FIELD:
   *   subject/body — form override ?? account override ?? null (stock template)
   *   enabled      — a form row EXISTS → its toggle wins; else the account row;
   *                  else the fork-friendly default (on).
   * Absent rows mean "inherit", so a form with no override behaves exactly as
   * before this feature existed.
   */
  private async resolveSetting(
    accountId: string,
    formId: string | null | undefined,
    emailKey: EmailKind,
  ): Promise<ResolvedEmailSetting> {
    const accountRow = (await getNotificationSettings(this.db, accountId)).get(emailKey);
    const formRow = formId
      ? (await getNotificationSettings(this.db, accountId, formId)).get(emailKey)
      : undefined;
    return {
      enabled: formRow ? formRow.enabled : (accountRow?.enabled ?? true),
      subject: formRow?.subject ?? accountRow?.subject ?? null,
      body: formRow?.body ?? accountRow?.body ?? null,
    };
  }

  /** Never rejects — the caller fire-and-forgets with `void`. */
  async enqueueSubmissionReceived(
    accountId: string,
    n: Omit<SubmissionNotification, 'accountId' | 'to'> & { to?: string[] },
    formId?: string | null,
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
      // Snapshot the toggle AND the custom copy, already merged form → account →
      // stock (absent rows = enabled with the stock template, the fork-friendly
      // default). Snapshotting here means the worker renders the copy the owner
      // had configured at the moment of the submission, toggle included.
      const setting = await this.resolveSetting(accountId, formId, 'submission_received');
      if (!setting.enabled) return;
      const payload: SubmissionNotification = {
        ...n,
        accountId,
        // Stamped into the payload, not merely used to resolve the template
        // above: `outbox` has no form column, so a row that does not NAME its
        // form cannot be attributed to one, and every email this queue has ever
        // carried was invisible to the per-form delivery history for that reason.
        formId: formId ?? null,
        to,
        locale: n.locale ?? owner?.locale ?? null,
        subjectTemplate: setting.subject,
        bodyTemplate: setting.body,
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
   * Confirmation receipt to the RESPONDENT ("we received your answers"), through
   * the same durable outbox as `submission_received` and gated by the same
   * notification_setting mechanism (`submission_confirmed`; absent rows =
   * enabled, the fork-friendly default), merged form → account → stock. No
   * respondent email in the answers → nothing to address, so it no-ops. Locale:
   * the public surface does not persist the respondent's language yet, so the
   * caller's value is used as-is (unset normalizes to English in the notifier).
   * Never rejects — the caller fire-and-forgets with `void`.
   */
  async enqueueSubmissionConfirmed(
    accountId: string,
    n: Omit<SubmissionNotification, 'accountId' | 'to'>,
    formId?: string | null,
  ): Promise<void> {
    try {
      if (!n.respondentEmail) return;
      // Snapshot the toggle AND the custom copy (merged form → account → stock).
      const setting = await this.resolveSetting(accountId, formId, 'submission_confirmed');
      if (!setting.enabled) return;
      const payload: SubmissionNotification = {
        ...n,
        accountId,
        // See `enqueueSubmissionReceived` — the payload has to name the form or
        // the admin cannot tell whose send this was.
        formId: formId ?? null,
        to: [n.respondentEmail],
        locale: n.locale ?? null,
        subjectTemplate: setting.subject,
        bodyTemplate: setting.body,
      };
      await enqueueOutbox(this.db, {
        kind: 'email',
        action: 'submission_confirmed',
        accountId,
        payload: JSON.stringify(payload),
      });
    } catch (err) {
      this.log.error(`failed to enqueue submission_confirmed: ${String(err)}`);
    }
  }

  /**
   * Tell an invited person they were invited.
   *
   * Until now `inviteMember` inserted a member row with status `invited` and
   * stopped — no email existed anywhere in the notifications package, so nobody
   * was ever told. Enqueued through the outbox like every other side-effect
   * (never sent inline from the request handler), so a mail provider being down
   * cannot fail the invite itself.
   *
   * Never rejects: the caller fire-and-forgets, and a member who was created
   * must not be un-created because the notice could not be queued.
   */
  async enqueueMemberInvited(input: {
    accountId: string;
    memberId: string;
    to: string;
    invitedBy?: string | null;
    locale?: string | null;
  }): Promise<void> {
    try {
      if (!input.to) return;
      const account = await this.db.get<{ name: string }>(
        sql`SELECT name FROM account WHERE id = ${input.accountId} LIMIT 1`,
      );
      const payload: MemberInvitedNotification = {
        accountId: input.accountId,
        memberId: input.memberId,
        to: input.to,
        accountName: account?.name ?? 'your workspace',
        invitedBy: input.invitedBy ?? null,
        // Empty in a bare fork with no PUBLIC_APP_URL — the template drops the
        // line rather than printing a broken link.
        signInLink: this.env?.PUBLIC_APP_URL ? `${this.env!.PUBLIC_APP_URL.replace(/\/$/, '')}/login` : null,
        locale: input.locale ?? null,
      };
      await enqueueOutbox(this.db, {
        kind: 'email',
        action: 'member_invited',
        accountId: input.accountId,
        subjectUid: input.memberId,
        payload: JSON.stringify(payload),
      });
    } catch (err) {
      this.log.error(`failed to enqueue member_invited: ${String(err)}`);
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
        'email outbox row missing account context: skipped (signed transport requires a tenant)',
      );
    }
    switch (action) {
      case 'member_invited':
        // A different payload shape rides the same `email` kind — decoded here
        // rather than given its own outbox kind, because the transport, the
        // retry policy and the missing-tenant decision above are identical.
        await this.notifier.sendMemberInvited(
          JSON.parse(payloadJson) as MemberInvitedNotification,
        );
        return;
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
