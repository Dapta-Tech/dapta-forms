import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailMessage, EmailProvider, EmailResult } from '../email.port';
import { formatSender, normalizeRecipients } from '../util';

export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  fromEmail: string;
  fromName?: string;
  replyTo?: string;
}

/**
 * SMTP transport via nodemailer. A pooled transporter is created once and
 * reused. A transport failure THROWS (the durable outbox worker catches it and
 * retries with backoff — B1/DM1); it is never swallowed to `delivered:false`,
 * which would look like success and silently drop the mail. A booking is still
 * never rolled back on an email failure — the effect runs out-of-band.
 */
export class SmtpEmailProvider implements EmailProvider {
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly replyTo?: string;

  constructor(opts: SmtpOptions, transporter?: Transporter) {
    this.from = formatSender(opts.fromEmail, opts.fromName);
    this.replyTo = opts.replyTo;
    this.transporter =
      transporter ??
      nodemailer.createTransport({
        host: opts.host,
        port: opts.port,
        secure: opts.secure,
        pool: true,
        auth: opts.user ? { user: opts.user, pass: opts.pass } : undefined,
      });
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    const to = normalizeRecipients(message.to);
    try {
      const info = await this.transporter.sendMail({
        from: message.from ?? this.from,
        to,
        replyTo: message.replyTo ?? this.replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: message.headers,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });
      return { delivered: true, messageId: info.messageId, driver: 'smtp' };
    } catch (err) {
      // Surface the failure so the outbox worker retries (never a silent drop).
      throw err instanceof Error ? err : new Error(`smtp send failed: ${String(err)}`);
    }
  }
}
