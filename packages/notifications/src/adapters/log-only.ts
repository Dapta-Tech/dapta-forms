import type { EmailMessage, EmailProvider, EmailResult } from '../email.port';
import { normalizeRecipients } from '../util';

/**
 * The default provider. Logs that an email *would* have been sent, without a
 * transport — so a bare clone runs submission flows end-to-end with nothing
 * configured. Logs recipients/subject/attachment names only, never the body
 * (avoids dumping PII into logs).
 */
export class LogOnlyEmailProvider implements EmailProvider {
  constructor(private readonly logger: Pick<Console, 'log'> = console) {}

  send(message: EmailMessage): Promise<EmailResult> {
    try {
      const to = normalizeRecipients(message.to);
      const attachments = (message.attachments ?? []).map((a) => a.filename);
      this.logger.log(
        `[email:log-only] not sent (no provider configured) → to=${to.join(',')} ` +
          `subject="${message.subject}"` +
          (attachments.length ? ` attachments=[${attachments.join(', ')}]` : ''),
      );
      return Promise.resolve({ delivered: false, driver: 'log-only' });
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
