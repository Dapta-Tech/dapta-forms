import { describe, it, expect } from 'vitest';
import { hasToken, interpolate, NOTIFICATION_SAMPLE } from './notification-preview';

describe('notification preview interpolate', () => {
  it('substitutes known {{tokens}} from the sample and tolerates whitespace', () => {
    expect(interpolate('New on {{formName}} / {{ score }}', NOTIFICATION_SAMPLE)).toBe(
      'New on Lead Qualifier / 15',
    );
  });

  it('leaves an unknown token literal (matches the server behavior)', () => {
    expect(interpolate('Hi {{nope}}', NOTIFICATION_SAMPLE)).toBe('Hi {{nope}}');
  });

  it('is single-pass: a sample value containing a marker is not re-expanded', () => {
    expect(interpolate('{{formName}}', { formName: '{{score}}', score: '9' })).toBe('{{score}}');
  });

  it('carries a multi-line answers sample so the preview shows the block as the email will', () => {
    expect(NOTIFICATION_SAMPLE.answers).toContain('\n');
    expect(NOTIFICATION_SAMPLE.answers!.split('\n').every((line) => /: /.test(line))).toBe(true);
  });

  it('renders the default owner template with all five tokens filled', () => {
    const body = [
      'You have a new submission on "{{formName}}".',
      'From: {{respondentEmail}}',
      'Score: {{score}}',
      'Outcome: {{outcomeLabel}}',
      'View submissions: {{formLink}}',
    ].join('\n');
    expect(interpolate(body, NOTIFICATION_SAMPLE)).toBe(
      [
        'You have a new submission on "Lead Qualifier".',
        'From: lead@acme.io',
        'Score: 15',
        'Outcome: Qualified',
        'View submissions: https://forms.example.com/admin/forms/lead-qualifier/submissions',
      ].join('\n'),
    );
  });
});

describe('hasToken', () => {
  it('finds the token with or without inner whitespace, and not another token', () => {
    expect(hasToken('A\n{{answers}}', 'answers')).toBe(true);
    expect(hasToken('{{ answers }}', 'answers')).toBe(true);
    expect(hasToken('{{answers }}', 'answers')).toBe(true);
    expect(hasToken('{{formName}} answers', 'answers')).toBe(false);
    expect(hasToken('', 'answers')).toBe(false);
  });
});
