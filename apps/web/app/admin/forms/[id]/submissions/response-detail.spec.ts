/**
 * What the response panel prints for each kind of answer.
 *
 * The panel exists because the table cannot show a long answer, so the thing to
 * pin is that every answer comes out whole and in the shape that reads: a
 * paragraph keeps its line breaks, a multi-select stays separate labels, a URL
 * is a link only when it is a web address, and a step nobody reached says so
 * instead of disappearing.
 */
import { describe, expect, it } from 'vitest';
import type { FormStep } from '@quill/engine';
import type { SubmissionView } from '@quill/types';
import { answerView, buildResponseDetail } from './response-detail';

const TZ = 'America/Bogota';

const step = (over: Partial<FormStep> & Pick<FormStep, 'key' | 'type'>): FormStep =>
  ({ question: '', required: false, ...over }) as FormStep;

const choices = step({
  key: 'role',
  type: 'multiple_choice',
  question: 'Your role?',
  options: [
    { label: 'Founder', value: 'founder' },
    { label: 'Sales lead', value: 'sales' },
  ],
} as Partial<FormStep> & Pick<FormStep, 'key' | 'type'>);

describe('answerView', () => {
  it('keeps a long answer whole, line breaks included', () => {
    const essay = 'First line of a long answer.\nSecond line, still the same answer.';
    const v = answerView(
      step({ key: 'story', type: 'textarea', question: 'Tell us' }),
      { story: essay },
      TZ,
    );
    expect(v).toEqual({ key: 'story', label: 'Tell us', kind: 'text', text: essay, long: true });
  });

  it('treats a short one-line text as a value, not a paragraph', () => {
    const v = answerView(
      step({ key: 'company', type: 'text', question: 'Company' }),
      { company: '  Acme  ' },
      TZ,
    );
    expect(v).toMatchObject({ kind: 'text', text: 'Acme', long: false });
  });

  it('prints each selected option as its own label', () => {
    const v = answerView(choices, { role: ['founder', 'sales'] }, TZ);
    expect(v).toEqual({
      key: 'role',
      label: 'Your role?',
      kind: 'choices',
      choices: ['Founder', 'Sales lead'],
    });
  });

  it('maps a single choice to its label and keeps an unknown value as typed', () => {
    expect(answerView(choices, { role: 'sales' }, TZ)).toMatchObject({
      kind: 'choices',
      choices: ['Sales lead'],
    });
    expect(answerView(choices, { role: 'retired' }, TZ)).toMatchObject({
      kind: 'choices',
      choices: ['retired'],
    });
  });

  it('links a web address and leaves anything else as text', () => {
    const url = step({ key: 'site', type: 'url', question: 'Website' });
    expect(answerView(url, { site: 'https://example.com/a' }, TZ)).toEqual({
      key: 'site',
      label: 'Website',
      kind: 'link',
      href: 'https://example.com/a',
      text: 'https://example.com/a',
    });
    expect(answerView(url, { site: 'javascript:alert(1)' }, TZ)).toMatchObject({ kind: 'text' });
  });

  it('shows a file by its name only', () => {
    const v = answerView(
      step({ key: 'id_doc', type: 'file', question: 'Upload your ID' }),
      {
        id_doc: {
          key: 'uploads/a/b/c/d.png',
          name: 'passport.png',
          size: '120',
          mime: 'image/png',
        },
      },
      TZ,
    );
    expect(v).toEqual({
      key: 'id_doc',
      label: 'Upload your ID',
      kind: 'file',
      name: 'passport.png',
    });
  });

  it('reads a name from its flat sub-fields', () => {
    const v = answerView(
      step({ key: 'name_18', type: 'name', question: 'Your name' }),
      { firstname: 'Laura', lastname: 'Pérez' },
      TZ,
    );
    expect(v).toMatchObject({ kind: 'text', text: 'Laura Pérez' });
  });

  it('reads a booking in the workspace zone', () => {
    const v = answerView(
      step({ key: 'meet', type: 'scheduler', question: 'Book' }),
      { meet: '2026-09-03T14:30:00.000Z' },
      TZ,
    );
    expect(v).toMatchObject({ kind: 'text', text: '2026-09-03 09:30 GMT-5' });
  });

  it('says "no answer" for a step the respondent never reached', () => {
    expect(
      answerView(step({ key: 'story', type: 'textarea', question: 'Tell us' }), {}, TZ),
    ).toEqual({
      key: 'story',
      label: 'Tell us',
      kind: 'empty',
    });
    expect(answerView(choices, { role: [] }, TZ)).toMatchObject({ kind: 'empty' });
  });

  it('heads the answer with the question this respondent read, and falls back to the key', () => {
    const variant = step({
      key: 'budget',
      type: 'text',
      question: 'Budget?',
      questionField: 'role',
      questionVariants: { founder: 'What budget can you approve?', '*': 'Budget?' },
    } as Partial<FormStep> & Pick<FormStep, 'key' | 'type'>);
    expect(answerView(variant, { role: 'founder', budget: '10k' }, TZ).label).toBe(
      'What budget can you approve?',
    );
    expect(answerView(step({ key: 'text_21', type: 'text' }), {}, TZ).label).toBe('text_21');
  });
});

describe('buildResponseDetail', () => {
  const row = (over: Partial<SubmissionView> = {}): SubmissionView => ({
    id: 'sub_1',
    formId: 'form_1',
    sessionId: 'sess_1',
    data: { company: 'Acme', utm: { utm_source: 'qr', utm_medium: 'print', utm_term: '' } },
    score: 7,
    startedAt: Date.UTC(2026, 8, 3, 14, 0),
    completedAt: Date.UTC(2026, 8, 3, 14, 5),
    partialAt: null,
    ...over,
  });
  const steps = [step({ key: 'company', type: 'text', question: 'Company' })];

  it('carries status, both dates, score, answers and the non-empty UTM parameters', () => {
    const d = buildResponseDetail(row(), steps, { locale: 'en', timeZone: TZ, scoring: true });
    expect(d.id).toBe('sub_1');
    expect(d.completed).toBe(true);
    expect(d.score).toBe(7);
    expect(d.submittedAt).toContain('9:05');
    expect(d.startedAt).toContain('9:00');
    expect(d.answers).toEqual([
      { key: 'company', label: 'Company', kind: 'text', text: 'Acme', long: false },
    ]);
    expect(d.utm).toEqual([
      ['utm_source', 'qr'],
      ['utm_medium', 'print'],
    ]);
  });

  it('has no score when the form does not score', () => {
    expect(
      buildResponseDetail(row(), steps, { locale: 'en', timeZone: TZ, scoring: false }).score,
    ).toBeNull();
  });

  it('dates a partial response by its partial instant, like the table', () => {
    const d = buildResponseDetail(
      row({ completedAt: null, partialAt: Date.UTC(2026, 8, 3, 14, 2) }),
      steps,
      { locale: 'en', timeZone: TZ, scoring: true },
    );
    expect(d.completed).toBe(false);
    expect(d.submittedAt).toContain('9:02');
  });

  it('has no UTM section when the respondent arrived without parameters', () => {
    expect(
      buildResponseDetail(row({ data: { company: 'Acme' } }), steps, {
        locale: 'en',
        timeZone: TZ,
        scoring: true,
      }).utm,
    ).toEqual([]);
  });
});
