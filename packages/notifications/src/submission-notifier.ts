import type { EmailProvider, EmailResult } from './email.port';
import { escapeHtml } from './util';
import {
  applyCopyOverride,
  normalizeLocale,
  renderMemberInvited,
  renderSubmissionConfirmed,
  renderSubmissionReceived,
  type NotificationLocale,
} from './templates';

/** Render plaintext lines to a safe HTML body — every line HTML-escaped (E8). */
function htmlBody(lines: string[]): string {
  return `<p>${lines.filter(Boolean).map(escapeHtml).join('<br/>')}</p>`;
}

/** Everything a submission notification needs to render, provider-agnostic. */
/** Everything the invitation email needs, resolved before it is enqueued. */
export interface MemberInvitedNotification {
  accountId: string;
  /** The member row this invitation belongs to (the idempotency anchor). */
  memberId: string;
  /** The invited address. */
  to: string;
  accountName: string;
  invitedBy?: string | null;
  signInLink?: string | null;
  locale?: string | null;
}

export interface SubmissionNotification {
  accountId: string;
  /** The submission id (used as the idempotency anchor). */
  submissionId: string;
  /**
   * Which form this is about. The notifier itself never reads it — it is here so
   * the enqueued payload NAMES the form, which is the only way an admin reading
   * the outbox can attribute a send to one. Optional because rows enqueued
   * before this existed carry no form and cannot be given one retroactively.
   */
  formId?: string | null;
  formName: string;
  /** Where to send it — the account/team inbox and/or the respondent. */
  to: string[];
  /** The respondent's own email, if captured (for the confirmation copy). */
  respondentEmail?: string | null;
  score?: number | null;
  outcomeLabel?: string | null;
  /** A public link back to the form (book-again style). */
  formLink?: string | null;
  /**
   * Language for the rendered copy. Accepts a bare `en`/`es` or any locale-ish
   * value (e.g. `es-CO`, an Accept-Language fragment) — normalized to one of the
   * two supported languages. Unset defaults to English (the bare-fork default).
   */
  locale?: NotificationLocale | string | null;
  /**
   * The account's custom subject/body override (from `notification_setting`),
   * snapshotted at enqueue time. Each is independent: a non-null value replaces
   * the stock copy (with `{{token}}` interpolation), null/absent keeps the stock
   * template. The body is plain text — the notifier escapes it on the HTML path
   * exactly like the stock lines, so a custom template stays XSS-safe (E8).
   */
  subjectTemplate?: string | null;
  bodyTemplate?: string | null;
}

/**
 * Renders and sends submission emails through the EmailProvider port — plain
 * text + escaped HTML, no attachments. The app only ever calls these methods;
 * the transport is whatever adapter is wired (log-only by default). Copy is
 * bilingual (EN/ES) via the templates module; the caller supplies `locale`.
 */
export class SubmissionNotifier {
  constructor(private readonly email: EmailProvider) {}

  /** Internal notice to the account: a new submission landed. */
  sendSubmissionReceived(n: SubmissionNotification): Promise<EmailResult> {
    const base = renderSubmissionReceived(normalizeLocale(n.locale), n);
    const { subject, lines } = applyCopyOverride(
      base,
      { subject: n.subjectTemplate, body: n.bodyTemplate },
      n,
    );
    const body = lines.filter(Boolean);
    return this.email.send({
      accountId: n.accountId,
      to: n.to,
      subject,
      text: body.join('\n'),
      html: htmlBody(body),
      headers: { 'X-Submission-Id': n.submissionId },
      idempotencyKey: `submission:${n.submissionId}:received`,
    });
  }

  /**
   * "You were added to a workspace." No copy override applies: this is platform
   * copy, not the per-account submission templates an owner can edit.
   */
  sendMemberInvited(n: MemberInvitedNotification): Promise<EmailResult> {
    const { subject, lines } = renderMemberInvited(normalizeLocale(n.locale), n);
    const body = lines.filter(Boolean);
    return this.email.send({
      accountId: n.accountId,
      to: [n.to],
      subject,
      text: body.join('\n'),
      html: htmlBody(body),
      // One invite per member row — a retried delivery must not read as a second
      // invitation to a managed service that de-duplicates on this key.
      idempotencyKey: `member:${n.memberId}:invited`,
    });
  }

  /** Confirmation to the respondent that their answers were recorded. */
  sendSubmissionConfirmed(n: SubmissionNotification): Promise<EmailResult> {
    const base = renderSubmissionConfirmed(normalizeLocale(n.locale), n);
    const { subject, lines } = applyCopyOverride(
      base,
      { subject: n.subjectTemplate, body: n.bodyTemplate },
      n,
    );
    const body = lines.filter(Boolean);
    return this.email.send({
      accountId: n.accountId,
      to: n.respondentEmail ? [n.respondentEmail] : n.to,
      subject,
      text: body.join('\n'),
      html: htmlBody(body),
      headers: { 'X-Submission-Id': n.submissionId },
      idempotencyKey: `submission:${n.submissionId}:confirmed`,
    });
  }
}
