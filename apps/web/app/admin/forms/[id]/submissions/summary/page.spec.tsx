/**
 * The Summary tab as it renders: one card per question with the numbers the
 * API computed, the text cards with their latest answers, the empty states,
 * and the Summary | Responses switch pointing at both routes.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import type { SubmissionsSummary } from '@quill/engine';

const getSummary = vi.fn();
const getForm = vi.fn();
const me = vi.fn();

vi.mock('@/lib/admin-api', () => ({
  adminApi: {
    getSummary: (...a: unknown[]) => getSummary(...a),
    getForm: (...a: unknown[]) => getForm(...a),
    me: (...a: unknown[]) => me(...a),
  },
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/lib/locale', () => ({ getLocale: async () => 'en' }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
// The search and the panel reach server actions; rendering needs neither.
vi.mock('./actions', () => ({
  searchSummaryAnswersAction: vi.fn(),
  summaryResponseAction: vi.fn(),
}));
vi.mock('../actions', () => ({
  deleteSubmissionAction: vi.fn(),
  submissionFileUrlAction: vi.fn(),
}));

import SummaryRoute from './page';

type AnyElement = ReactElement<{ children?: unknown }>;
const isElement = (v: unknown): v is AnyElement =>
  typeof v === 'object' && v !== null && 'type' in v && 'props' in v;

function find(node: unknown, match: (el: AnyElement) => boolean): AnyElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, match);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!isElement(node)) return undefined;
  if (match(node)) return node;
  return find(node.props?.children, match);
}

/** The page's HTML with its async data part resolved (static render cannot await). */
async function render(): Promise<string> {
  const page = await SummaryRoute({ params: Promise.resolve({ id: 'form_1' }) });
  const data = find(page, (el) => typeof el.type === 'function' && el.type.name === 'SummaryData');
  if (!data) throw new Error('no SummaryData');
  const resolved = await (data.type as (p: unknown) => Promise<ReactElement>)(data.props);
  const header = renderToStaticMarkup(
    find(
      page,
      (el) =>
        el.props && (el.props as { className?: string }).className === 'mb-6 flex flex-col gap-4',
    )!,
  );
  return header + renderToStaticMarkup(resolved);
}

const summary: SubmissionsSummary = {
  total: 30,
  questions: [
    {
      kind: 'choice',
      key: 'services',
      type: 'multiple_choice',
      label: 'Which services?',
      answered: 18,
      total: 30,
      multiple: true,
      options: [
        { value: 'ein', label: 'EIN', count: 15, percent: 83 },
        { value: 'bank', label: 'Bank account', count: 9, percent: 50 },
      ],
    },
    {
      kind: 'scale',
      key: 'size',
      type: 'slider',
      label: 'Team size?',
      answered: 4,
      total: 30,
      average: 43.8,
      unit: 'people',
      buckets: [
        { from: 1, to: 10, count: 3, percent: 75 },
        { from: 11, to: 20, count: 1, percent: 25 },
      ],
    },
    {
      kind: 'text',
      key: 'notes',
      type: 'textarea',
      label: 'Anything else?',
      answered: 7,
      total: 30,
      recent: [
        {
          id: 'sub_9',
          text: 'Call me after 5',
          respondent: null,
          at: Date.UTC(2026, 8, 3, 14, 30),
        },
      ],
    },
    { kind: 'count', key: 'deck', type: 'file', label: 'Your deck', answered: 2, total: 30 },
    {
      kind: 'text',
      key: 'website',
      type: 'url',
      label: 'Website',
      answered: 0,
      total: 30,
      recent: [],
    },
  ],
};

beforeEach(() => {
  getSummary.mockReset();
  me.mockReset();
  me.mockResolvedValue({ timezone: 'America/Bogota' });
  getForm.mockReset();
  getForm.mockResolvedValue({ id: 'form_1' });
});

describe('Summary tab', () => {
  it('asks the API for this form and draws one card per question, in order', async () => {
    getSummary.mockResolvedValue(summary);
    const html = await render();
    expect(getSummary).toHaveBeenCalledWith('form_1');
    const keys = [...html.matchAll(/data-question-key="([^"]+)"/g)].map((m) => m[1]);
    expect(keys).toEqual(['services', 'size', 'notes', 'deck', 'website']);
    expect(html).toContain('18 of 30 answered');
  });

  it('prints each option with its share and count, and the multi-select note', async () => {
    getSummary.mockResolvedValue(summary);
    const html = await render();
    expect(html).toContain('EIN');
    expect(html).toMatch(/83%<\/span>.*15/);
    expect(html).toContain('width:83%');
    expect(html).toContain('data-testid="summary-multi-note"');
  });

  it('prints a slider average and its ranges', async () => {
    getSummary.mockResolvedValue(summary);
    const html = await render();
    expect(html).toMatch(/data-testid="summary-average"[^>]*>43\.8</);
    expect(html).toContain('people');
    expect(html).toContain('1–10');
  });

  it('lists the latest text answers, anonymous when the form asked no contact, in the workspace zone', async () => {
    getSummary.mockResolvedValue(summary);
    const html = await render();
    expect(html).toContain('Call me after 5');
    expect(html).toContain('Anonymous');
    // 14:30 UTC read in Bogotá.
    expect(html).toContain('9:30');
    expect(html).toContain('data-response-id="sub_9"');
    expect(html).toContain('data-testid="summary-show-more"');
  });

  it('counts files, and says so when nobody answered a question', async () => {
    getSummary.mockResolvedValue(summary);
    const html = await render();
    expect(html).toMatch(/data-testid="summary-count"[^>]*>2</);
    expect(html).toContain('Nobody has answered this question yet.');
  });

  it('shows the empty state for a form with no responses', async () => {
    getSummary.mockResolvedValue({ total: 0, questions: [] });
    const html = await render();
    expect(html).toContain('No submissions yet');
    expect(html).not.toContain('data-testid="summary-card"');
  });

  it('answers 404 before rendering anything for a form outside the workspace', async () => {
    const { ApiError } = await import('@/lib/admin-api');
    getForm.mockRejectedValue(new ApiError(404, 'Not found.'));
    await expect(SummaryRoute({ params: Promise.resolve({ id: 'form_x' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(getSummary).not.toHaveBeenCalled();
  });

  it('switches between Summary and Responses, marking the one open', async () => {
    getSummary.mockResolvedValue(summary);
    const html = await render();
    expect(html).toMatch(
      /<a aria-current="page" data-view="summary"[^>]*href="\/admin\/forms\/form_1\/submissions\/summary"/,
    );
    expect(html).toMatch(/<a data-view="responses"[^>]*href="\/admin\/forms\/form_1\/submissions"/);
  });
});
