/**
 * The column plan: what an author starts from, and the rules a row list obeys
 * before it is stored.
 */
import { describe, expect, it } from 'vitest';
import type { FormStep } from '@quill/engine';
import type { SheetColumn } from '@quill/types';
import { mappableQuestions, type QuestionMeta } from './auto-map';
import {
  defaultColumns,
  columnMissing,
  isCompleteColumn,
  moveColumn,
  sameHeaders,
  storedColumns,
} from './sheet-columns';

const LABELS = {
  submittedAt: 'Submitted',
  score: 'Score',
  outcome: 'Outcome',
  formName: 'Form',
  submissionId: 'Response ID',
};

const QUESTIONS: QuestionMeta[] = [
  { key: 'email', label: 'Your email', type: 'email' },
  { key: 'company', label: 'Company', type: 'text' },
];

describe('defaultColumns', () => {
  it('gives a name question two columns, one per stored answer, not one that stays empty', () => {
    const questions = mappableQuestions(
      [
        { key: 'email', type: 'email', question: 'Email' } as FormStep,
        { key: 'full_name', type: 'name', question: 'Nombre y Apellido' } as FormStep,
      ],
      { first: 'Nombre', last: 'Apellido' },
    );
    expect(defaultColumns(questions, LABELS)).toEqual([
      { header: 'Submitted', source: 'submitted_at' },
      { header: 'Email', source: 'answer', key: 'email' },
      { header: 'Nombre y Apellido · Nombre', source: 'answer', key: 'firstname' },
      { header: 'Nombre y Apellido · Apellido', source: 'answer', key: 'lastname' },
      { header: 'Score', source: 'score' },
      { header: 'Outcome', source: 'outcome' },
    ]);
  });

  it('puts the date first, then the questions in the form’s order', () => {
    // A sheet is sorted by its first column, and what people sort submissions
    // by is when they arrived.
    expect(defaultColumns(QUESTIONS, LABELS)).toEqual([
      { header: 'Submitted', source: 'submitted_at' },
      { header: 'Your email', source: 'answer', key: 'email' },
      { header: 'Company', source: 'answer', key: 'company' },
      { header: 'Score', source: 'score' },
      { header: 'Outcome', source: 'outcome' },
    ]);
  });

  it('titles a column after the question key when the label is empty', () => {
    const plan = defaultColumns([{ key: 'q1', label: '', type: 'text' }], LABELS);
    expect(plan[1]).toEqual({ header: 'q1', source: 'answer', key: 'q1' });
  });

  it('adds no campaign columns, which most forms never set', () => {
    const plan = defaultColumns(QUESTIONS, LABELS);
    expect(plan.some((c) => c.source === 'utm')).toBe(false);
  });

  it('still gives a plan for a form with no questions yet', () => {
    expect(defaultColumns([], LABELS)).toHaveLength(3);
  });
});

describe('isCompleteColumn', () => {
  it('needs a heading', () => {
    expect(isCompleteColumn({ header: '  ', source: 'score' })).toBe(false);
    expect(isCompleteColumn({ header: 'Score', source: 'score' })).toBe(true);
  });

  it('needs the key for the two sources that name something', () => {
    expect(isCompleteColumn({ header: 'Email', source: 'answer' })).toBe(false);
    expect(isCompleteColumn({ header: 'Email', source: 'answer', key: 'email' })).toBe(true);
    expect(isCompleteColumn({ header: 'Source', source: 'utm' })).toBe(false);
    expect(isCompleteColumn({ header: 'Source', source: 'utm', key: 'utm_source' })).toBe(true);
  });
});

describe('storedColumns', () => {
  it('keeps the incomplete rows (they survive a reload) and trims every row', () => {
    const columns: SheetColumn[] = [
      { header: '  Email  ', source: 'answer', key: ' email ' },
      { header: '', source: 'score' },
      { header: 'Unfinished', source: 'answer', key: '  ' },
      { header: 'Score', source: 'score' },
    ];
    expect(storedColumns(columns)).toEqual([
      { header: 'Email', source: 'answer', key: 'email' },
      { header: '', source: 'score' },
      { header: 'Unfinished', source: 'answer' },
      { header: 'Score', source: 'score' },
    ]);
  });

  it('names exactly what an unfinished row still needs', () => {
    expect(columnMissing({ header: 'booking', source: 'answer' })).toBe('source');
    expect(columnMissing({ header: '', source: 'answer', key: 'email' })).toBe('header');
    expect(columnMissing({ header: ' ', source: 'utm' })).toBe('both');
    expect(columnMissing({ header: '', source: 'score' })).toBe('header');
    expect(columnMissing({ header: 'Score', source: 'score' })).toBeNull();
  });

  it('leaves no key behind on a source that takes none', () => {
    expect(storedColumns([{ header: 'Score', source: 'score', key: 'stale' }])).toEqual([
      { header: 'Score', source: 'score', key: 'stale' },
    ]);
  });
});

describe('moveColumn', () => {
  const plan: SheetColumn[] = [
    { header: 'A', source: 'score' },
    { header: 'B', source: 'outcome' },
    { header: 'C', source: 'submitted_at' },
  ];

  it('moves a row up and down', () => {
    expect(moveColumn(plan, 2, -1).map((c) => c.header)).toEqual(['A', 'C', 'B']);
    expect(moveColumn(plan, 0, 1).map((c) => c.header)).toEqual(['B', 'A', 'C']);
  });

  it('leaves the list alone at the ends, so the first row’s "up" is harmless', () => {
    expect(moveColumn(plan, 0, -1)).toBe(plan);
    expect(moveColumn(plan, 2, 1)).toBe(plan);
    expect(moveColumn(plan, 9, -1)).toBe(plan);
  });

  it('does not mutate the list it was given', () => {
    const before = [...plan];
    moveColumn(plan, 0, 1);
    expect(plan).toEqual(before);
  });
});

describe('sameHeaders', () => {
  it('compares headings, not what fills them', () => {
    const a: SheetColumn[] = [{ header: 'Email', source: 'answer', key: 'email' }];
    const b: SheetColumn[] = [{ header: 'Email', source: 'answer', key: 'work_email' }];
    expect(sameHeaders(a, b)).toBe(true);
    expect(sameHeaders(a, [{ header: 'Address', source: 'answer', key: 'email' }])).toBe(false);
    expect(sameHeaders(a, [...a, { header: 'Score', source: 'score' }])).toBe(false);
  });
});
