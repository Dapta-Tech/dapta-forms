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
    expect(m.subject).toBe('Nueva respuesta: Calificador');
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

  it('uses the account custom subject/body, interpolating {{tokens}}', async () => {
    const provider = new CaptureProvider();
    const notifier = new SubmissionNotifier(provider);
    await notifier.sendSubmissionReceived({
      accountId: 'acc-1',
      submissionId: 'sub-4',
      formName: 'Lead Qualifier',
      to: ['owner@example.com'],
      respondentEmail: 'lead@acme.io',
      score: 15,
      subjectTemplate: 'New lead on {{formName}} ({{score}})',
      bodyTemplate: '{{respondentEmail}} scored {{score}}\nForm: {{formName}}',
    });
    const m = provider.sent[0]!;
    expect(m.subject).toBe('New lead on Lead Qualifier (15)');
    expect(m.text).toBe('lead@acme.io scored 15\nForm: Lead Qualifier');
    expect(m.html).toBe('<p>lead@acme.io scored 15<br/>Form: Lead Qualifier</p>');
  });

  it('ESCAPES interpolated values in a custom body (E8 — the boundary holds)', async () => {
    const provider = new CaptureProvider();
    const notifier = new SubmissionNotifier(provider);
    await notifier.sendSubmissionReceived({
      accountId: 'acc-1',
      submissionId: 'sub-5',
      formName: '<script>alert(1)</script>',
      to: ['owner@example.com'],
      subjectTemplate: 'Sub {{formName}}',
      bodyTemplate: 'Body: {{formName}}',
    });
    const m = provider.sent[0]!;
    // The raw text carries the literal value; the HTML path escapes it.
    expect(m.text).toBe('Body: <script>alert(1)</script>');
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
  });

  it('applies a custom template on the respondent confirmation too', async () => {
    const provider = new CaptureProvider();
    const notifier = new SubmissionNotifier(provider);
    await notifier.sendSubmissionConfirmed({
      accountId: 'acc-1',
      submissionId: 'sub-6',
      formName: 'Survey',
      to: ['owner@example.com'],
      respondentEmail: 'lead@acme.io',
      subjectTemplate: 'Thanks for {{formName}}',
      bodyTemplate: 'We got it, see {{formLink}}',
      formLink: 'https://forms.example.com/x',
    });
    const m = provider.sent[0]!;
    expect(m.to).toEqual(['lead@acme.io']);
    expect(m.subject).toBe('Thanks for Survey');
    expect(m.text).toBe('We got it, see https://forms.example.com/x');
  });
});
