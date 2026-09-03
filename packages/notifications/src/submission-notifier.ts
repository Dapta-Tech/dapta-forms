import type { EmailProvider, EmailResult } from './email.port';
import { escapeHtml } from './util';
import { emailDocument, type AnswerRow } from './render-html';
import {
  normalizeLocale,
  renderMemberInvited,
  renderSubmissionEmail,
  type NotificationLocale,
} from './templates';

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
  /** Where the owner reads the answers (the admin submissions page). Never set on the receipt. */
  formLink?: string | null;
  /**
   * The answers, resolved to `{label, value}` rows in step order by the caller
   * (the API, via the engine). Printed by the `{{answers}}` token.
   */
  answers?: AnswerRow[] | null;
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
 * Renders and sends submission emails through the EmailProvider port — a plain
 * text body plus a complete HTML document (escaped line by line, the answers as
 * a table), no attachments. The app only ever calls these methods; the
 * transport is whatever adapter is wired (log-only by default). Copy is
 * bilingual (EN/ES) via the templates module; the caller supplies `locale`.
 */
export class SubmissionNotifier {
  constructor(private readonly email: EmailProvider) {}

  /** Internal notice to the account: a new submission landed. */
  sendSubmissionReceived(n: SubmissionNotification): Promise<EmailResult> {
    const locale = normalizeLocale(n.locale);
    const { subject, text, html } = renderSubmissionEmail(
      'submission_received',
      locale,
      { subject: n.subjectTemplate, body: n.bodyTemplate },
      n,
    );
    return this.email.send({
      accountId: n.accountId,
      to: n.to,
      subject,
      text: text.join('\n'),
      html: emailDocument({ lang: locale, lines: html }),
      headers: { 'X-Submission-Id': n.submissionId },
      idempotencyKey: `submission:${n.submissionId}:received`,
    });
  }

  /**
   * "You were added to a workspace." No copy override applies: this is platform
   * copy, not the per-account submission templates an owner can edit.
   */
  sendMemberInvited(n: MemberInvitedNotification): Promise<EmailResult> {
    const locale = normalizeLocale(n.locale);
    const { subject, lines } = renderMemberInvited(locale, n);
    const body = lines.filter(Boolean);
    return this.email.send({
      accountId: n.accountId,
      to: [n.to],
      subject,
      text: body.join('\n'),
      // Platform copy with interpolated names: escape every line (E8).
      html: emailDocument({ lang: locale, lines: body.map(escapeHtml) }),
      // One invite per member row — a retried delivery must not read as a second
      // invitation to a managed service that de-duplicates on this key.
      idempotencyKey: `member:${n.memberId}:invited`,
    });
  }

  /** Confirmation to the respondent that their answers were recorded. */
  sendSubmissionConfirmed(n: SubmissionNotification): Promise<EmailResult> {
    const locale = normalizeLocale(n.locale);
    const { subject, text, html } = renderSubmissionEmail(
      'submission_confirmed',
      locale,
      { subject: n.subjectTemplate, body: n.bodyTemplate },
      n,
    );
    return this.email.send({
      accountId: n.accountId,
      to: n.respondentEmail ? [n.respondentEmail] : n.to,
      subject,
      text: text.join('\n'),
      html: emailDocument({ lang: locale, lines: html }),
      headers: { 'X-Submission-Id': n.submissionId },
      idempotencyKey: `submission:${n.submissionId}:confirmed`,
    });
  }
}
