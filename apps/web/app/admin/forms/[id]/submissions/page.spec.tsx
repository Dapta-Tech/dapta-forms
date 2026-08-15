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
 *
 * Two oracles carry the weight. Every case asserts the exact query the page
 * asked the API (form, status, limit, offset), because the right answer to the
 * wrong question is not a passing page. And every redirect is re-entered, so
 * the target is proven to be a place that renders rather than one that
 * redirects again.
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

/** One submissions query as the page actually issued it. */
type Query = { formId: string; status: string; limit: number; offset: number };

/**
 * Every submissions query issued so far in the current test, in order.
 *
 * Asserting the ANSWER alone cannot see a page that asks the wrong question —
 * a dropped filter, a different page size, or an offset the clamp invented
 * rather than derived. Mocks are cleared per test, so across a redirect and the
 * visit that follows it this list is the whole conversation with the API.
 */
function queriesSoFar(): Query[] {
  return listSubmissions.mock.calls.map(([formId, q]) => ({
    formId,
    status: q?.status,
    limit: q?.limit,
    offset: q?.offset,
  }));
}

/** The form ids the page looked up, in order — one per visit. */
const formLookupsSoFar = (): unknown[] => getForm.mock.calls.map(([id]) => id);

const query = (over: Partial<Query> = {}): Query => ({
  formId: FORM_ID,
  status: 'all',
  limit: PAGE_SIZE,
  offset: 0,
  ...over,
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
}): Promise<{
  redirectedTo: string | null;
  text: string;
  queries: Query[];
  formLookups: unknown[];
}> {
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
    return {
      redirectedTo: null,
      text: textOf(tree),
      queries: queriesSoFar(),
      formLookups: formLookupsSoFar(),
    };
  } catch (e) {
    if (e instanceof Error && e.message === REDIRECT) {
      return {
        redirectedTo: (e as Error & { url: string }).url,
        text: '',
        queries: queriesSoFar(),
        formLookups: formLookupsSoFar(),
      };
    }
    throw e;
  }
}

/**
 * Follow a redirect the way a browser would: read the target's own query string
 * and ask for exactly that, against the same unchanged data.
 *
 * A redirect target is only correct if it is somewhere to LAND. Asserting the
 * URL string proves the page computed one; re-entering it proves the page
 * accepts it — that the clamp did not hand back another offset past the end and
 * start a loop, and that the filter it wrote survives being read back.
 */
async function reenter(url: string, total: number) {
  const target = new URL(url, 'https://forms.example.test');
  expect(target.pathname).toBe(`/admin/forms/${FORM_ID}/submissions`);

  const status = target.searchParams.get('status');
  if (status !== null && status !== 'completed' && status !== 'partial') {
    throw new Error(`redirect wrote an unusable status: ${status}`);
  }
  return visit({
    ...(status ? { status } : {}),
    offset: Number(target.searchParams.get('offset') ?? 0),
    total,
  });
}

describe('submissions pagination — offset past the last row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends the browser to the last page with rows after the only row on page 2 is deleted', async () => {
    // 26 → 25 with the browser still on `offset=25`: page 2 no longer exists.
    const { redirectedTo, text, queries, formLookups } = await visit({ offset: 25, total: 25 });

    // Nothing renders on the way out, so "26–25 of 25" never reaches a reader.
    expect(text).toBe('');
    expect(redirectedTo).toBe(`/admin/forms/${FORM_ID}/submissions`);
    // The clamp reacted to the answer to THIS question, asked for THIS form.
    expect(queries).toEqual([query({ offset: 25 })]);
    expect(formLookups).toEqual([FORM_ID]);

    const back = await reenter(redirectedTo!, 25);
    expect(back.redirectedTo).toBeNull();
    expect(back.text).toContain('1–25 of 25');
    expect(back.queries).toEqual([query({ offset: 25 }), query({ offset: 0 })]);
    expect(back.formLookups).toEqual([FORM_ID, FORM_ID]);
  });

  it('keeps the status filter across the clamp', async () => {
    const { redirectedTo, queries } = await visit({ status: 'completed', offset: 25, total: 25 });

    expect(redirectedTo).toBe(`/admin/forms/${FORM_ID}/submissions?status=completed`);
    expect(queries).toEqual([query({ status: 'completed', offset: 25 })]);

    // The filter has to survive the hop in the QUERY, not just in the URL.
    const back = await reenter(redirectedTo!, 25);
    expect(back.redirectedTo).toBeNull();
    expect(back.text).toContain('1–25 of 25');
    expect(back.queries).toEqual([
      query({ status: 'completed', offset: 25 }),
      query({ status: 'completed', offset: 0 }),
    ]);
  });

  it('clamps to the last page that still has rows, not to the first', async () => {
    // 80 rows, offset 200: the last page holding rows starts at 75.
    const { redirectedTo, queries } = await visit({
      status: 'partial',
      offset: 200,
      total: 80,
      items: 0,
    });

    expect(redirectedTo).toBe(`/admin/forms/${FORM_ID}/submissions?status=partial&offset=75`);
    expect(queries).toEqual([query({ status: 'partial', offset: 200 })]);

    const back = await reenter(redirectedTo!, 80);
    expect(back.redirectedTo).toBeNull();
    expect(back.text).toContain('76–80 of 80');
    expect(back.queries).toEqual([
      query({ status: 'partial', offset: 200 }),
      query({ status: 'partial', offset: 75 }),
    ]);
  });

  it('leaves a valid last-page offset alone', async () => {
    // The control: 26 rows, offset 25 — page 2 legitimately holds the 26th.
    const { redirectedTo, text, queries, formLookups } = await visit({ offset: 25, total: 26 });

    expect(redirectedTo).toBeNull();
    expect(text).toContain('26–26 of 26');
    expect(queries).toEqual([query({ offset: 25 })]);
    expect(formLookups).toEqual([FORM_ID]);
  });

  it('leaves the first page alone', async () => {
    const { redirectedTo, text, queries } = await visit({ offset: 0, total: 25 });

    expect(redirectedTo).toBeNull();
    expect(text).toContain('1–25 of 25');
    expect(queries).toEqual([query({ offset: 0 })]);
  });

  it('still shows the empty state when the filter matches nothing', async () => {
    // total 0 has no last page to clamp to; the empty state owns this case.
    const { redirectedTo, text, queries } = await visit({
      status: 'completed',
      offset: 25,
      total: 0,
    });

    expect(redirectedTo).toBeNull();
    expect(text).toContain('No submissions yet');
    // Still the filtered question — the empty state is not a fallback to `all`.
    expect(queries).toEqual([query({ status: 'completed', offset: 25 })]);
  });
});
