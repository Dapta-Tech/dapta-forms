/**
 * A checkbox column in the submissions CSV: its header is the box's text with
 * each inline link read as its text, and a checked box reads as a check.
 */
import { describe, it, expect } from 'vitest';
import type { FormStep } from '@quill/engine';
import { exportColumns, type ExportLabels, type ExportRow } from './csv';

const labels: ExportLabels = {
  firstName: 'First name',
  lastName: 'Last name',
  submittedAt: 'Submitted at',
  status: 'Status',
  score: 'Score',
  submissionId: 'Submission ID',
  pageUrl: 'Page URL',
};

const row = (data: Record<string, unknown>): ExportRow => ({
  id: 'r1',
  data,
  score: null,
  status: 'Completed',
  submittedAt: '2026-11-02 10:00',
  pageUri: '',
});

describe('csv: checkbox column', () => {
  const steps: FormStep[] = [
    { key: 'email', type: 'email', question: 'Email' },
    { key: 'consent', type: 'checkbox', question: 'Acepto la [política de datos](https://example.com/privacidad)', required: true },
  ];
  const cols = exportColumns(steps, { scoring: false, labels });
  const consent = cols.find((c) => c.header === 'Acepto la política de datos');

  it('heads the column with the text, without the link syntax', () => {
    expect(consent).toBeDefined();
    expect(cols.some((c) => c.header.includes('](https://'))).toBe(false);
  });

  it('prints a check for true and nothing when unanswered', () => {
    expect(consent!.value(row({ consent: true }))).toBe('✓');
    expect(consent!.value(row({}))).toBe('');
  });
});
