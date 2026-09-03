import { describe, it, expect } from 'vitest';
import {
  applyCopyOverride,
  defaultSubmissionTemplate,
  interpolateTokens,
  isSubmissionEmailKey,
  normalizeLocale,
  notificationTokenValues,
  NOTIFICATION_TOKENS,
  renderBodyLines,
  renderSubmissionConfirmed,
  renderSubmissionReceived,
  SUBMISSION_EMAIL_KEYS,
} from './templates';

describe('normalizeLocale', () => {
  it('maps Spanish-ish values to es and everything else to en', () => {
    expect(normalizeLocale('es')).toBe('es');
    expect(normalizeLocale('es-CO')).toBe('es');
    expect(normalizeLocale('ES_es')).toBe('es');
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('fr')).toBe('en');
    expect(normalizeLocale(undefined)).toBe('en');
    expect(normalizeLocale(null)).toBe('en');
    expect(normalizeLocale('')).toBe('en');
  });
});

describe('renderSubmissionReceived', () => {
  it('renders the English owner notice with interpolated fields', () => {
    const { subject, lines } = renderSubmissionReceived('en', {
      formName: 'Lead Qualifier',
      respondentEmail: 'lead@acme.io',
      score: 15,
      outcomeLabel: 'Qualified',
    });
    expect(subject).toBe('New submission: Lead Qualifier');
    const text = lines.filter(Boolean).join('\n');
    expect(text).toContain('Lead Qualifier');
    expect(text).toContain('From: lead@acme.io');
    expect(text).toContain('Score: 15');
    expect(text).toContain('Outcome: Qualified');
  });

  it('renders the Spanish owner notice', () => {
    const { subject, lines } = renderSubmissionReceived('es', {
      formName: 'Calificador de Leads',
      respondentEmail: 'lead@acme.io',
      score: 15,
      outcomeLabel: 'Calificado',
    });
    expect(subject).toBe('Nueva respuesta: Calificador de Leads');
    const text = lines.filter(Boolean).join('\n');
    expect(text).toContain('Recibiste una nueva respuesta');
    expect(text).toContain('De: lead@acme.io');
    expect(text).toContain('Puntuación: 15');
    expect(text).toContain('Resultado: Calificado');
  });

  it('drops absent optional fields (only the headline line remains)', () => {
    const { lines } = renderSubmissionReceived('en', { formName: 'Survey' });
    expect(lines.filter(Boolean)).toHaveLength(1);
  });

  it('prints the answers as "Label: value" lines between the outcome and the link', () => {
    const { lines } = renderSubmissionReceived('en', {
      formName: 'Survey',
      outcomeLabel: 'Hot',
      formLink: 'https://forms.example.com/admin/forms/f1/submissions',
      answers: [
        { label: 'Role', value: 'Founder' },
        { label: 'Team size', value: '20' },
      ],
    });
    expect(lines.join('\n')).toBe(
      [
        'You have a new submission on "Survey".',
        'Outcome: Hot',
        '',
        'Role: Founder',
        'Team size: 20',
        '',
        'View submissions: https://forms.example.com/admin/forms/f1/submissions',
      ].join('\n'),
    );
  });
});

describe('renderSubmissionConfirmed', () => {
  it('renders EN and ES respondent confirmations with the form link', () => {
    const en = renderSubmissionConfirmed('en', { formName: 'Survey', formLink: 'https://forms.example.com/x' });
    expect(en.subject).toBe('We got your responses: Survey');
    expect(en.lines.join('\n')).toContain('View or edit: https://forms.example.com/x');

    const es = renderSubmissionConfirmed('es', { formName: 'Encuesta', formLink: 'https://forms.example.com/x' });
    expect(es.subject).toBe('Recibimos tus respuestas: Encuesta');
    expect(es.lines.join('\n')).toContain('Ver o editar: https://forms.example.com/x');
  });
});

describe('interpolateTokens', () => {
  const values = { formName: 'Lead Qualifier', respondentEmail: 'lead@acme.io', score: '15' };

  it('substitutes known {{tokens}} and tolerates inner whitespace', () => {
    expect(interpolateTokens('Hi {{formName}} / {{ score }}', values)).toBe('Hi Lead Qualifier / 15');
  });

  it('leaves an unknown token literal (a visible typo, not a silent blank)', () => {
    expect(interpolateTokens('X {{nope}} Y', values)).toBe('X {{nope}} Y');
  });

  it('is single-pass: a value that contains a token marker is NOT re-expanded', () => {
    expect(interpolateTokens('{{formName}}', { formName: '{{score}}', score: '99' })).toBe('{{score}}');
  });
});

describe('notificationTokenValues', () => {
  it('maps absent optionals to empty strings and stringifies score', () => {
    expect(notificationTokenValues({ formName: 'F', score: 0 })).toEqual({
      formName: 'F',
      respondentEmail: '',
      score: '0',
      outcomeLabel: '',
      formLink: '',
      answers: '',
    });
  });

  it('renders the answers as one "Label: value" line each', () => {
    expect(
      notificationTokenValues({
        formName: 'F',
        answers: [
          { label: 'Role', value: 'Founder' },
          { label: 'Why', value: 'Speed' },
        ],
      }).answers,
    ).toBe('Role: Founder\nWhy: Speed');
  });

  it('offers {{answers}} as a token', () => {
    expect(NOTIFICATION_TOKENS).toContain('answers');
  });
});

describe('renderBodyLines', () => {
  const text = { formName: 'Survey', score: '', outcomeLabel: '', answers: 'Role: Founder' };
  const html = { formName: 'Survey', score: '', outcomeLabel: '', answers: '<table></table>' };

  it('keeps a line with no tokens, even a blank one', () => {
    const out = renderBodyLines('Hello', text, html);
    expect(out.text).toEqual(['Hello']);
    expect(out.html).toEqual(['Hello']);
  });

  it('drops a line only when it has tokens and every token resolved empty', () => {
    const out = renderBodyLines('Score: {{score}}\nName: {{formName}}\n{{score}} / {{outcomeLabel}}', text, html);
    expect(out.text).toEqual(['Name: Survey']);
  });

  it('keeps a line where at least one token resolved', () => {
    const out = renderBodyLines('{{score}} on {{formName}}', text, html);
    expect(out.text).toEqual([' on Survey']);
  });

  it('keeps an unknown token literal and does not count it as empty', () => {
    const out = renderBodyLines('{{nope}}', text, html);
    expect(out.text).toEqual(['{{nope}}']);
  });

  it('escapes the template text on the html side but substitutes html token values raw', () => {
    const out = renderBodyLines('<b>{{formName}}</b>\n{{answers}}', { ...text, formName: 'A & B' }, { ...html, formName: 'A &amp; B' });
    expect(out.text).toEqual(['<b>A & B</b>', 'Role: Founder']);
    expect(out.html).toEqual(['&lt;b&gt;A &amp; B&lt;/b&gt;', '<table></table>']);
  });

  it('collapses runs of blank lines left behind and trims blank ends', () => {
    const out = renderBodyLines('\nA\n\n{{score}}\n\nB\n', text, html);
    expect(out.text).toEqual(['A', '', 'B']);
    expect(out.html).toEqual(['A', '', 'B']);
  });
});

describe('applyCopyOverride', () => {
  const base = renderSubmissionReceived('en', { formName: 'Survey' });
  const vars = { formName: 'Survey', respondentEmail: 'lead@acme.io', score: 7, outcomeLabel: 'Hot' };

  it('keeps the stock copy when no override is set (null/undefined)', () => {
    expect(applyCopyOverride(base, { subject: null, body: null }, vars)).toEqual(base);
    expect(applyCopyOverride(base, {}, vars)).toEqual(base);
  });

  it('overrides subject + body independently, interpolating tokens', () => {
    const out = applyCopyOverride(
      base,
      { subject: 'Lead from {{formName}}', body: 'Score {{score}}\nfor {{respondentEmail}}' },
      vars,
    );
    expect(out.subject).toBe('Lead from Survey');
    expect(out.lines).toEqual(['Score 7', 'for lead@acme.io']);
  });

  it('collapses newlines in a custom subject (header stays single-line)', () => {
    const out = applyCopyOverride(base, { subject: 'A {{formName}}\r\nB' }, vars);
    expect(out.subject).toBe('A Survey B');
  });

  it('overriding only the body leaves the stock subject intact', () => {
    const out = applyCopyOverride(base, { body: 'just body {{formName}}' }, vars);
    expect(out.subject).toBe(base.subject);
    expect(out.lines).toEqual(['just body Survey']);
  });
});

describe('defaultSubmissionTemplate (stays in sync with the code templates)', () => {
  const full = {
    formName: 'Lead Qualifier',
    respondentEmail: 'lead@acme.io',
    score: 15,
    outcomeLabel: 'Qualified',
    formLink: 'https://forms.example.com/x',
    answers: [{ label: 'Role', value: 'Founder' }],
  };

  it('the owner default carries {{answers}}; the respondent default does not', () => {
    for (const locale of ['en', 'es'] as const) {
      expect(defaultSubmissionTemplate('submission_received', locale).body).toContain('{{answers}}');
      expect(defaultSubmissionTemplate('submission_confirmed', locale).body).not.toContain('{{answers}}');
    }
  });

  it('SUBMISSION_EMAIL_KEYS are exactly the two customizable emails', () => {
    expect([...SUBMISSION_EMAIL_KEYS]).toEqual(['submission_received', 'submission_confirmed']);
    expect(isSubmissionEmailKey('submission_received')).toBe(true);
    expect(isSubmissionEmailKey('reminder')).toBe(false);
  });

  it('reproduces the stock received copy when interpolated with full vars (EN + ES)', () => {
    for (const locale of ['en', 'es'] as const) {
      const def = defaultSubmissionTemplate('submission_received', locale);
      const stock = renderSubmissionReceived(locale, full);
      expect(interpolateTokens(def.subject, notificationTokenValues(full))).toBe(stock.subject);
      expect(interpolateTokens(def.body, notificationTokenValues(full))).toBe(stock.lines.join('\n'));
    }
  });

  it('reproduces the stock confirmed copy when interpolated with full vars (EN + ES)', () => {
    for (const locale of ['en', 'es'] as const) {
      const def = defaultSubmissionTemplate('submission_confirmed', locale);
      const stock = renderSubmissionConfirmed(locale, full);
      expect(interpolateTokens(def.subject, notificationTokenValues(full))).toBe(stock.subject);
      expect(interpolateTokens(def.body, notificationTokenValues(full))).toBe(stock.lines.join('\n'));
    }
  });
});
