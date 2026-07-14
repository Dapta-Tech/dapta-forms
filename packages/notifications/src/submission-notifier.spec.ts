import { describe, it, expect } from 'vitest';
import { SubmissionNotifier } from './submission-notifier';
import type { EmailMessage, EmailProvider, EmailResult } from './email.port';

class CaptureProvider implements EmailProvider {
  sent: EmailMessage[] = [];
  send(message: EmailMessage): Promise<EmailResult> {
    this.sent.push(message);
    return Promise.resolve({ delivered: true, driver: 'noop' });
  }
}

describe('SubmissionNotifier', () => {
  it('sends the internal received notice with a stable idempotency key and NO attachments', async () => {
    const provider = new CaptureProvider();
    const notifier = new SubmissionNotifier(provider);
    await notifier.sendSubmissionReceived({
      accountId: 'acc-1',
      submissionId: 'sub-1',
      formName: 'Lead Qualifier',
      to: ['owner@example.com'],
      respondentEmail: 'lead@acme.io',
      score: 15,
      outcomeLabel: 'Qualified',
    });
    expect(provider.sent).toHaveLength(1);
    const m = provider.sent[0]!;
    expect(m.to).toEqual(['owner@example.com']);
    expect(m.subject).toContain('Lead Qualifier');
    expect(m.idempotencyKey).toBe('submission:sub-1:received');
    // Submission emails carry no attachments by design.
    expect(m.attachments).toBeUndefined();
    expect(m.text).toContain('Score: 15');
    expect(m.text).toContain('Outcome: Qualified');
  });

  it('renders the received notice in Spanish when locale=es', async () => {
    const provider = new CaptureProvider();
    const notifier = new SubmissionNotifier(provider);
    await notifier.sendSubmissionReceived({
      accountId: 'acc-1',
      submissionId: 'sub-es',
      formName: 'Calificador',
      to: ['owner@example.com'],
      respondentEmail: 'lead@acme.io',
      score: 9,
      locale: 'es-CO',
    });
    const m = provider.sent[0]!;
    expect(m.subject).toBe('Nueva respuesta — Calificador');
    expect(m.text).toContain('Puntuación: 9');
    expect(m.text).toContain('De: lead@acme.io');
    // Idempotency key is language-independent.
    expect(m.idempotencyKey).toBe('submission:sub-es:received');
  });

  it('confirms to the respondent when their email was captured', async () => {
    const provider = new CaptureProvider();
    const notifier = new SubmissionNotifier(provider);
    await notifier.sendSubmissionConfirmed({
      accountId: 'acc-1',
      submissionId: 'sub-2',
      formName: 'Survey',
      to: ['owner@example.com'],
      respondentEmail: 'lead@acme.io',
    });
    expect(provider.sent[0]!.to).toEqual(['lead@acme.io']);
    expect(provider.sent[0]!.idempotencyKey).toBe('submission:sub-2:confirmed');
  });

  it('HTML-escapes user-provided values (E8)', async () => {
    const provider = new CaptureProvider();
    const notifier = new SubmissionNotifier(provider);
    await notifier.sendSubmissionReceived({
      accountId: 'acc-1',
      submissionId: 'sub-3',
      formName: '<script>alert(1)</script>',
      to: ['owner@example.com'],
    });
    expect(provider.sent[0]!.html).not.toContain('<script>');
    expect(provider.sent[0]!.html).toContain('&lt;script&gt;');
  });
});
