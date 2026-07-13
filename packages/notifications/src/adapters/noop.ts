import type { EmailMessage, EmailProvider, EmailResult } from '../email.port';
import { normalizeRecipients } from '../util';

/** Silent sink — validates the recipient, sends nothing, logs nothing. */
export class NoopEmailProvider implements EmailProvider {
  send(message: EmailMessage): Promise<EmailResult> {
    normalizeRecipients(message.to);
    return Promise.resolve({ delivered: false, driver: 'noop' });
  }
}
