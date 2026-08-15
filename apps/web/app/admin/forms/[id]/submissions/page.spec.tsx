/**
 * Pagination that survives the last row on the page being deleted.
 *
 * `?offset=` is user-controlled and outlives the rows it pointed at. Delete the
 * only submission on page 2 (total 26 → 25) and the browser is still sitting on
 * `offset=25`: the API answers with an empty `items` and an authoritative
 * `total` of 25, which is NOT the empty-state the page checks for. The table
 * then rendered a header with no rows under the count "26–25 of 25" — a range
 * that cannot exist — with Next disabled because `offset + limit >= total` and
 * Prev the only way out. The same happens on any stale or hand-typed offset.
 *
 * The fix reads `total` (authoritative, computed before pagination) and sends
 * the browser to the last page that still has rows, so the filter survives the
 * hop. These tests pin the redirect target, the preserved status filter, and —
 * just as importantly — that a valid offset is left completely alone.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Suspense, type ReactElement } from 'react';
import type { SubmissionsPage as SubmissionsPageData } from '@quill/types';

const getForm = vi.fn();
const listSubmissions = vi.fn();

vi.mock('@/lib/admin-api', () => ({
  adminApi: {
    getForm: (...a: unknown[]) => getForm(...a),
    listSubmissions: (...a: unknown[]) => listSubmissions(...a),
  },
  // Declared in the factory: `vi.mock` is hoisted above every top-level binding,
  // and the page imports this one eagerly.
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

/** Next's `redirect` throws to abort the render; the mock keeps that contract. */
const REDIRECT = 'NEXT_REDIRECT';
const redirect = vi.fn((url: string) => {
  const e = new Error(REDIRECT) as Error & { url: string };
  e.url = url;
  throw e;
});

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirect(url),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  // Imported by the client-side status filter that this page renders.
  useRouter: () => ({ push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import SubmissionsRoute from './page';

const FORM_ID = 'form_1';
const PAGE_SIZE = 25;

type AnyElement = ReactElement<{ children?: unknown }>;

const isElement = (v: unknown): v is AnyElement =>
  typeof v === 'object' && v !== null && 'type' in v && 'props' in v;

/** First element in the tree that satisfies `match`, depth-first. */
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

/** Every string/number leaf in the tree, joined — what a reader would see. */
function textOf(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (isElement(node)) return textOf(node.props?.children);
  return '';
}

const submission = (id: string) => ({
  id,
  score: 0,
  data: {},
  startedAt: '2024-05-01T10:00:00.000Z',
  partialAt: null,
  completedAt: '2024-05-01T10:05:00.000Z',
});

/**
 * Run the page for one URL and one API answer, and report what the reader gets:
 * either a redirect target, or the text the table rendered.
 *
 * The data fetch lives in the page's suspended child so the shell can stream, so
 * that child is what has to be invoked — it is the component that learns `total`
 * and therefore the only one that can react to it.
 */
async function visit(opts: {
  status?: 'completed' | 'partial';
  offset: number;
  total: number;
  items?: number;
}): Promise<{ redirectedTo: string | null; text: string }> {
  const items = opts.items ?? Math.max(0, Math.min(PAGE_SIZE, opts.total - opts.offset));
  const page: SubmissionsPageData = {
    items: Array.from({ length: items }, (_, i) => submission(`s${opts.offset + i}`)),
    total: opts.total,
    limit: PAGE_SIZE,
    offset: opts.offset,
  } as unknown as SubmissionsPageData;

  getForm.mockResolvedValue({ id: FORM_ID, config: { version: 1, steps: [] } });
  listSubmissions.mockResolvedValue(page);

  const shell = await SubmissionsRoute({
    params: Promise.resolve({ id: FORM_ID }),
    searchParams: Promise.resolve({
      ...(opts.status ? { status: opts.status } : {}),
      offset: String(opts.offset),
    }),
  });

  const boundary = find(shell, (el) => el.type === Suspense);
  const data = boundary?.props?.children as AnyElement | undefined;
  if (!data || typeof data.type !== 'function') throw new Error('suspended data child not found');

  try {
    const tree = await (data.type as (p: unknown) => Promise<unknown>)(data.props);
    return { redirectedTo: null, text: textOf(tree) };
  } catch (e) {
    if (e instanceof Error && e.message === REDIRECT) {
      return { redirectedTo: (e as Error & { url: string }).url, text: '' };
    }
    throw e;
  }
}

describe('submissions pagination — offset past the last row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends the browser to the last page with rows after the only row on page 2 is deleted', async () => {
    // 26 → 25 with the browser still on `offset=25`: page 2 no longer exists.
    const { redirectedTo, text } = await visit({ offset: 25, total: 25 });

    // Nothing renders on the way out, so "26–25 of 25" never reaches a reader.
    expect(text).toBe('');
    expect(redirectedTo).toBe(`/admin/forms/${FORM_ID}/submissions`);
  });

  it('keeps the status filter across the clamp', async () => {
    const { redirectedTo } = await visit({ status: 'completed', offset: 25, total: 25 });

    expect(redirectedTo).toBe(`/admin/forms/${FORM_ID}/submissions?status=completed`);
  });

  it('clamps to the last page that still has rows, not to the first', async () => {
    // 80 rows, offset 200: the last page holding rows starts at 75.
    const { redirectedTo } = await visit({ status: 'partial', offset: 200, total: 80, items: 0 });

    expect(redirectedTo).toBe(`/admin/forms/${FORM_ID}/submissions?status=partial&offset=75`);
  });

  it('leaves a valid last-page offset alone', async () => {
    // The control: 26 rows, offset 25 — page 2 legitimately holds the 26th.
    const { redirectedTo, text } = await visit({ offset: 25, total: 26 });

    expect(redirectedTo).toBeNull();
    expect(text).toContain('26–26 of 26');
  });

  it('leaves the first page alone', async () => {
    const { redirectedTo, text } = await visit({ offset: 0, total: 25 });

    expect(redirectedTo).toBeNull();
    expect(text).toContain('1–25 of 25');
  });

  it('still shows the empty state when the filter matches nothing', async () => {
    // total 0 has no last page to clamp to; the empty state owns this case.
    const { redirectedTo, text } = await visit({ status: 'completed', offset: 25, total: 0 });

    expect(redirectedTo).toBeNull();
    expect(text).toContain('No submissions yet');
  });
});
