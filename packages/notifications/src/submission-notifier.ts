import type { EmailProvider, EmailResult } from './email.port';
import { escapeHtml } from './util';
import {
  normalizeLocale,
  renderSubmissionConfirmed,
  renderSubmissionReceived,
  type NotificationLocale,
} from './templates';

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
  /**
   * Language for the rendered copy. Accepts a bare `en`/`es` or any locale-ish
   * value (e.g. `es-CO`, an Accept-Language fragment) — normalized to one of the
   * two supported languages. Unset defaults to English (the bare-fork default).
   */
  locale?: NotificationLocale | string | null;
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
    const { subject, lines } = renderSubmissionReceived(normalizeLocale(n.locale), n);
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

  /** Confirmation to the respondent that their answers were recorded. */
  sendSubmissionConfirmed(n: SubmissionNotification): Promise<EmailResult> {
    const { subject, lines } = renderSubmissionConfirmed(normalizeLocale(n.locale), n);
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
