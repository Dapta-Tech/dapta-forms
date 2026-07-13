import type { EmailProvider, EmailResult } from './email.port';
import { escapeHtml } from './util';

/** Render plaintext lines to a safe HTML body — every line HTML-escaped (E8). */
function htmlBody(lines: string[]): string {
  return `<p>${lines.filter(Boolean).map(escapeHtml).join('<br/>')}</p>`;
}

/** Everything a submission notification needs to render, provider-agnostic. */
export interface SubmissionNotification {
  accountId: string;
  /** The submission id (used as the idempotency anchor). */
  submissionId: string;
  formName: string;
  /** Where to send it — the account/team inbox and/or the respondent. */
  to: string[];
  /** The respondent's own email, if captured (for the confirmation copy). */
  respondentEmail?: string | null;
  score?: number | null;
  outcomeLabel?: string | null;
  /** A public link back to the form (book-again style). */
  formLink?: string | null;
}

/**
 * Renders and sends submission emails through the EmailProvider port — plain
 * text + escaped HTML, no attachments. The app only ever calls these methods;
 * the transport is whatever adapter is wired (log-only by default).
 */
export class SubmissionNotifier {
  constructor(private readonly email: EmailProvider) {}

  /** Internal notice to the account: a new submission landed. */
  sendSubmissionReceived(n: SubmissionNotification): Promise<EmailResult> {
    const lines = [
      `New submission for "${n.formName}".`,
      n.respondentEmail ? `From: ${n.respondentEmail}` : '',
      n.score != null ? `Score: ${n.score}` : '',
      n.outcomeLabel ? `Outcome: ${n.outcomeLabel}` : '',
    ];
    return this.email.send({
      accountId: n.accountId,
      to: n.to,
      subject: `New submission — ${n.formName}`,
      text: lines.filter(Boolean).join('\n'),
      html: htmlBody(lines),
      headers: { 'X-Submission-Id': n.submissionId },
      idempotencyKey: `submission:${n.submissionId}:received`,
    });
  }

  /** Confirmation to the respondent that their answers were recorded. */
  sendSubmissionConfirmed(n: SubmissionNotification): Promise<EmailResult> {
    const lines = [
      `Thanks — we received your responses to "${n.formName}".`,
      n.formLink ? `View or edit: ${n.formLink}` : '',
    ];
    return this.email.send({
      accountId: n.accountId,
      to: n.respondentEmail ? [n.respondentEmail] : n.to,
      subject: `We got your responses — ${n.formName}`,
      text: lines.filter(Boolean).join('\n'),
      html: htmlBody(lines),
      headers: { 'X-Submission-Id': n.submissionId },
      idempotencyKey: `submission:${n.submissionId}:confirmed`,
    });
  }
}
