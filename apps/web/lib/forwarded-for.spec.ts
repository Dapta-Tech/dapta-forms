import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forwardedForChain, forwardedForHeader } from './forwarded-for';

const headersMock = vi.hoisted(() => vi.fn());
vi.mock('next/headers', () => ({ headers: headersMock }));

function requestHeaders(entries: Record<string, string>) {
  return { get: (k: string) => entries[k.toLowerCase()] ?? null };
}

beforeEach(() => {
  headersMock.mockReset();
});

describe('forwardedForChain', () => {
  it('returns the incoming chain verbatim — proxy hop math belongs to the API', async () => {
    headersMock.mockResolvedValue(
      requestHeaders({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2' }),
    );
    await expect(forwardedForChain()).resolves.toBe('203.0.113.7, 10.0.0.2');
  });

  it('returns null when the request has no chain (direct-exposed self-host)', async () => {
    headersMock.mockResolvedValue(requestHeaders({}));
    await expect(forwardedForChain()).resolves.toBeNull();
  });

  it('returns null outside a request scope instead of throwing', async () => {
    headersMock.mockRejectedValue(new Error('headers called outside a request scope'));
    await expect(forwardedForChain()).resolves.toBeNull();
  });
});

describe('forwardedForHeader', () => {
  it('spreads into fetch headers when a chain exists', async () => {
    headersMock.mockResolvedValue(requestHeaders({ 'x-forwarded-for': '203.0.113.7' }));
    await expect(forwardedForHeader()).resolves.toEqual({ 'x-forwarded-for': '203.0.113.7' });
  });

  it('is empty when there is nothing to forward — no empty-string header sent', async () => {
    headersMock.mockResolvedValue(requestHeaders({}));
    await expect(forwardedForHeader()).resolves.toEqual({});
  });
});
