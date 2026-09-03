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
    expect(m.html).toContain('lead@acme.io scored 15<br/>Form: Lead Qualifier');
  });

  it('sends a complete HTML document (doctype, lang, viewport, closing body)', async () => {
    const provider = new CaptureProvider();
    const notifier = new SubmissionNotifier(provider);
    await notifier.sendSubmissionReceived({
      accountId: 'acc-1',
      submissionId: 'sub-doc',
      formName: 'Survey',
      to: ['owner@example.com'],
      locale: 'es',
    });
    const html = provider.sent[0]!.html!;
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('name="viewport"');
    expect(html.trimEnd().endsWith('</body></html>')).toBe(true);
  });

  it('puts the answers in the owner notice: "Label: value" in text, a table in HTML, escaped', async () => {
    const provider = new CaptureProvider();
    const notifier = new SubmissionNotifier(provider);
    await notifier.sendSubmissionReceived({
      accountId: 'acc-1',
      submissionId: 'sub-ans',
      formName: 'Lead Qualifier',
      to: ['owner@example.com'],
      score: 15,
      outcomeLabel: 'Qualified',
      formLink: 'https://forms.example.com/admin/forms/f1/submissions',
      answers: [
        { label: 'Role', value: 'Founder' },
        { label: 'Why', value: '<script>alert(1)</script>' },
      ],
    });
    const m = provider.sent[0]!;
    expect(m.text).toBe(
      [
        'You have a new submission on "Lead Qualifier".',
        'Score: 15',
        'Outcome: Qualified',
        '',
        'Role: Founder',
        'Why: <script>alert(1)</script>',
        '',
        'View submissions: https://forms.example.com/admin/forms/f1/submissions',
      ].join('\n'),
    );
    expect(m.html).toContain('<table');
    expect(m.html).toContain('Founder');
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(m.html).toContain('View submissions: https://forms.example.com/admin/forms/f1/submissions');
  });

  it('a custom body can place {{answers}} anywhere, in both emails', async () => {
    const provider = new CaptureProvider();
    const notifier = new SubmissionNotifier(provider);
    const answers = [{ label: 'Role', value: 'Founder' }];
    await notifier.sendSubmissionReceived({
      accountId: 'acc-1',
      submissionId: 'sub-c1',
      formName: 'Survey',
      to: ['owner@example.com'],
      bodyTemplate: 'Top\n{{answers}}\nBottom',
      answers,
    });
    await notifier.sendSubmissionConfirmed({
      accountId: 'acc-1',
      submissionId: 'sub-c2',
      formName: 'Survey',
      to: [],
      respondentEmail: 'lead@acme.io',
      bodyTemplate: 'Your answers:\n{{answers}}',
      answers,
    });
    expect(provider.sent[0]!.text).toBe('Top\nRole: Founder\nBottom');
    expect(provider.sent[0]!.html).toContain('Top<br/><table');
    expect(provider.sent[1]!.text).toBe('Your answers:\nRole: Founder');
    expect(provider.sent[1]!.html).toContain('<table');
  });

  it('the invitation email is a complete HTML document too', async () => {
    const provider = new CaptureProvider();
    const notifier = new SubmissionNotifier(provider);
    await notifier.sendMemberInvited({
      accountId: 'acc-1',
      memberId: 'm-1',
      to: 'new@example.com',
      accountName: '<Acme>',
      signInLink: 'https://forms.example.com/login',
    });
    const m = provider.sent[0]!;
    expect(m.html!.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(m.html).toContain('&lt;Acme&gt;');
    expect(m.html).not.toContain('<Acme>');
    expect(m.text).toContain('Sign in: https://forms.example.com/login');
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
