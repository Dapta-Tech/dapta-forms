import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublicForm, postFormEvent, postSubmission } from './api';

const headersMock = vi.hoisted(() => vi.fn());
vi.mock('next/headers', () => ({ headers: headersMock }));

function requestHeaders(entries: Record<string, string>) {
  return { get: (k: string) => entries[k.toLowerCase()] ?? null };
}

function jsonResponse(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  headersMock.mockReset();
  headersMock.mockResolvedValue(requestHeaders({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2' }));
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Every server-side call made on a visitor's behalf must carry the visitor's
 * X-Forwarded-For chain — otherwise the API rate-limits ALL visitors as one
 * client (the web server's IP). See `lib/forwarded-for.ts`.
 */
describe('visitor IP forwarding to the public API', () => {
  it('getPublicForm forwards the chain on the config fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { slug: 's', name: 'n', config: {} }));
    await getPublicForm('acme', 'lead-qualifier');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2' });
  });

  it('postSubmission forwards the chain alongside content-type', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { id: '1', score: 0, outcome: null }));
    await postSubmission('acme', 'lead-qualifier', { sessionId: 's1', data: {} });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.7, 10.0.0.2',
    });
  });

  it('postFormEvent forwards the chain', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200));
    await postFormEvent('acme', 'lead-qualifier', { sessionId: 's1', type: 'view' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2' });
  });

  it('sends no forwarding header when the incoming request has none', async () => {
    headersMock.mockResolvedValue(requestHeaders({}));
    fetchMock.mockResolvedValue(jsonResponse(200));
    await postFormEvent('acme', 'lead-qualifier', { sessionId: 's1', type: 'view' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('x-forwarded-for');
  });
});
