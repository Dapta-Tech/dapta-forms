import { describe, expect, it } from 'vitest';
import type { FormStep } from './form-logic';
import {
  isFilterableChoiceStep,
  summarizeFacets,
  isTextSummaryStep,
  summarizeSubmissions,
  summaryAnswer,
  summaryAnswerFields,
  summaryRespondent,
  type QuestionSummary,
  type SummaryRow,
} from './submissions-summary';

const step = (partial: Partial<FormStep> & Pick<FormStep, 'key' | 'type'>): FormStep => partial;

const steps: FormStep[] = [
  step({ key: 'intro', type: 'message', question: 'Welcome' }),
  step({ key: 'name', type: 'name', question: 'Your name?' }),
  step({ key: 'email', type: 'email', question: 'Email' }),
  step({
    key: 'role',
    type: 'multiple_choice',
    question: 'Your role?',
    options: [
      { label: 'Founder', value: 'founder' },
      { label: 'Marketing', value: 'marketing' },
      { label: 'Sales', value: 'sales' },
    ],
  }),
  step({
    key: 'services',
    type: 'multiple_choice',
    selectionMode: 'multiple',
    question: 'Services?',
    options: [
      { label: 'EIN', value: 'ein' },
      { label: 'Bank account', value: 'bank' },
    ],
  }),
  step({
    key: 'city',
    type: 'dropdown',
    question: 'City?',
    options: [
      { label: 'Bogotá', value: 'bog' },
      { label: 'Miami', value: 'mia' },
    ],
  }),
  step({
    key: 'size',
    type: 'slider',
    question: 'Team size?',
    min: 1,
    max: 10,
    sliderUnitLabel: 'people',
  }),
  step({ key: 'notes', type: 'textarea', question: 'Anything else?' }),
  step({ key: 'deck', type: 'file', question: 'Your deck' }),
  step({ key: 'meeting', type: 'scheduler', question: 'Book a call' }),
];

const row = (id: string, at: number, data: Record<string, unknown>): SummaryRow => ({
  id,
  at,
  data,
});

// Newest first, as the table lists them.
const rows: SummaryRow[] = [
  row('r4', 4000, {
    firstname: 'Ana',
    lastname: 'Gómez',
    email: 'ana@example.com',
    role: 'founder',
    services: ['ein', 'bank'],
    city: 'bog',
    size: 4,
    notes: 'Call me after 5',
    deck: { key: 'uploads/a.pdf', name: 'deck.pdf' },
    meeting: '2026-09-03T14:30:00.000Z',
  }),
  row('r3', 3000, { email: 'bo@example.com', role: 'founder', services: ['ein'], size: '6' }),
  row('r2', 2000, { firstname: 'Cy', role: 'marketing', services: [], notes: '   ' }),
  // A partial response that stopped at the first question.
  row('r1', 1000, {}),
];

function question<K extends QuestionSummary['kind']>(
  summary: { questions: QuestionSummary[] },
  key: string,
  kind: K,
): Extract<QuestionSummary, { kind: K }> {
  const q = summary.questions.find((x) => x.key === key);
  if (!q || q.kind !== kind) throw new Error(`no ${kind} question ${key}`);
  return q as Extract<QuestionSummary, { kind: K }>;
}

describe('summarizeSubmissions', () => {
  const summary = summarizeSubmissions(steps, rows);

  it('has one card per answering step, in form order, and skips message steps', () => {
    expect(summary.total).toBe(4);
    expect(summary.questions.map((q) => q.key)).toEqual([
      'name',
      'email',
      'role',
      'services',
      'city',
      'size',
      'notes',
      'deck',
      'meeting',
    ]);
    expect(summary.questions.every((q) => q.total === 4)).toBe(true);
  });

  it('counts a single choice per option with labels, most chosen first, unchosen options at zero', () => {
    const role = question(summary, 'role', 'choice');
    expect(role.answered).toBe(3);
    expect(role.multiple).toBe(false);
    expect(role.options).toEqual([
      { value: 'founder', label: 'Founder', count: 2, percent: 67 },
      { value: 'marketing', label: 'Marketing', count: 1, percent: 33 },
      { value: 'sales', label: 'Sales', count: 0, percent: 0 },
    ]);
  });

  it('counts a multi-select per chosen option, so percentages can add past 100', () => {
    const services = question(summary, 'services', 'choice');
    // An empty array is not an answer.
    expect(services.answered).toBe(2);
    expect(services.multiple).toBe(true);
    expect(services.options).toEqual([
      { value: 'ein', label: 'EIN', count: 2, percent: 100 },
      { value: 'bank', label: 'Bank account', count: 1, percent: 50 },
    ]);
  });

  it('counts a dropdown like a single choice', () => {
    const city = question(summary, 'city', 'choice');
    expect(city.answered).toBe(1);
    expect(city.options.map((o) => [o.label, o.count])).toEqual([
      ['Bogotá', 1],
      ['Miami', 0],
    ]);
  });

  it('keeps a stored value no option carries any more, under its raw value', () => {
    const s = summarizeSubmissions(steps, [
      row('a', 2, { role: 'retired' }),
      row('b', 1, { role: 'retired' }),
    ]);
    const role = question(s, 'role', 'choice');
    expect(role.options[0]).toEqual({ value: 'retired', label: 'retired', count: 2, percent: 100 });
  });

  it('counts a response once per option even if the stored array repeats it', () => {
    const s = summarizeSubmissions(steps, [row('a', 1, { services: ['ein', 'ein'] })]);
    expect(question(s, 'services', 'choice').options[0]).toMatchObject({
      value: 'ein',
      count: 1,
      percent: 100,
    });
  });

  it('averages a slider stored as a number or as text, with one bar per value', () => {
    const size = question(summary, 'size', 'scale');
    expect(size.answered).toBe(2);
    expect(size.average).toBe(5);
    expect(size.unit).toBe('people');
    expect(size.buckets).toEqual([
      { from: 4, to: 4, count: 1, percent: 50 },
      { from: 6, to: 6, count: 1, percent: 50 },
    ]);
  });

  it('groups a slider with many distinct answers into ten ranges over its bounds', () => {
    const wide = step({ key: 'n', type: 'slider', min: 1, max: 100 });
    const values = [1, 5, 12, 19, 25, 33, 47, 58, 61, 77, 88, 100];
    const s = summarizeSubmissions(
      [wide],
      values.map((v, i) => row(`r${i}`, i, { n: v })),
    );
    const n = question(s, 'n', 'scale');
    expect(n.average).toBe(43.8);
    expect(n.buckets).toHaveLength(10);
    expect(n.buckets[0]).toMatchObject({ from: 1, to: 10, count: 2 });
    expect(n.buckets[1]).toMatchObject({ from: 11, to: 20, count: 2 });
    expect(n.buckets[9]).toMatchObject({ from: 91, to: 100, count: 1 });
    expect(n.buckets.reduce((a, b) => a + b.count, 0)).toBe(values.length);
  });

  it('lists the latest text answers newest first, with who answered and when', () => {
    const notes = question(summary, 'notes', 'text');
    // Whitespace alone is not an answer.
    expect(notes.answered).toBe(1);
    expect(notes.recent).toEqual([
      { id: 'r4', text: 'Call me after 5', respondent: 'Ana Gómez', at: 4000 },
    ]);
  });

  it('reads a name step from its flat sub-fields', () => {
    const name = question(summary, 'name', 'text');
    expect(name.answered).toBe(2);
    expect(name.recent.map((a) => a.text)).toEqual(['Ana Gómez', 'Cy']);
  });

  it('caps the latest answers', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      row(`r${i}`, 100 - i, { email: `p${i}@example.com` }),
    );
    const email = question(summarizeSubmissions(steps, many), 'email', 'text');
    expect(email.answered).toBe(8);
    expect(email.recent.map((a) => a.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
    expect(
      question(summarizeSubmissions(steps, many, { recent: 2 }), 'email', 'text').recent,
    ).toHaveLength(2);
  });

  it('counts files and bookings that were answered', () => {
    expect(question(summary, 'deck', 'count').answered).toBe(1);
    expect(question(summary, 'meeting', 'count').answered).toBe(1);
  });

  it('describes a form with no responses without dividing by zero', () => {
    const empty = summarizeSubmissions(steps, []);
    expect(empty.total).toBe(0);
    const role = question(empty, 'role', 'choice');
    expect(role.answered).toBe(0);
    expect(role.options.every((o) => o.count === 0 && o.percent === 0)).toBe(true);
    const size = question(empty, 'size', 'scale');
    expect(size.average).toBeNull();
    expect(size.buckets).toEqual([]);
    expect(question(empty, 'notes', 'text').recent).toEqual([]);
  });

  it('labels a question with no text by its key', () => {
    const s = summarizeSubmissions([step({ key: 'q9', type: 'text' })], []);
    expect(s.questions[0]!.label).toBe('q9');
  });
});

describe('summary helpers', () => {
  it('names the respondent by name, else email, else phone, else nobody', () => {
    const contact = [
      step({ key: 'name', type: 'name' }),
      step({ key: 'email', type: 'email' }),
      step({ key: 'phone', type: 'phone' }),
    ];
    expect(summaryRespondent(contact, { firstname: 'Ana', email: 'a@x.co' })).toBe('Ana');
    expect(summaryRespondent(contact, { email: 'a@x.co', phone: '+57 300' })).toBe('a@x.co');
    expect(summaryRespondent(contact, { phone: '+57 300' })).toBe('+57 300');
    expect(summaryRespondent(contact, {})).toBeNull();
  });

  it('builds one search hit, or null when that response left the question blank', () => {
    const notes = steps.find((s) => s.key === 'notes')!;
    expect(summaryAnswer(steps, notes, rows[0]!)).toMatchObject({
      id: 'r4',
      text: 'Call me after 5',
    });
    expect(summaryAnswer(steps, notes, rows[2]!)).toBeNull();
  });

  it('knows which steps are searchable and where their answers are stored', () => {
    expect(steps.filter(isTextSummaryStep).map((s) => s.key)).toEqual(['name', 'email', 'notes']);
    expect(summaryAnswerFields(steps[1]!)).toEqual(['firstname', 'lastname']);
    expect(summaryAnswerFields(steps[2]!)).toEqual(['email']);
  });

  it('knows which steps the table can filter by: the ones answered from a set of options', () => {
    const types = ['multiple_choice', 'dropdown', 'text', 'name', 'email', 'url', 'slider', 'file'] as const;
    expect(types.filter((type) => isFilterableChoiceStep({ type }))).toEqual(['multiple_choice', 'dropdown']);
  });

  it('counts the filter menus over every response: status, and each option in form order', () => {
    const facetSteps = [
      { key: 'kind', type: 'dropdown', question: 'Kind', options: [
        { value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }, { value: 'c', label: 'Gamma' },
      ] },
      { key: 'notes', type: 'text', question: 'Notes' },
    ] as unknown as FormStep[];
    const facets = summarizeFacets(facetSteps, {
      total: 4,
      completed: 2,
      partial: 1,
      choices: { kind: { answered: 3, values: { b: 2, old: 1 } }, notes: { answered: 9, values: { x: 9 } } },
    });
    expect(facets).toMatchObject({ total: 4, completed: 2, partial: 1 });
    expect(Object.keys(facets.choices)).toEqual(['kind']);
    expect(facets.choices.kind!.map((o) => [o.value, o.label, o.count, o.percent])).toEqual([
      ['a', 'Alpha', 0, 0],
      ['b', 'Beta', 2, 67],
      ['c', 'Gamma', 0, 0],
      ['old', 'old', 1, 33],
    ]);
  });
});
