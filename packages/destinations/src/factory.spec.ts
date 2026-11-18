/**
 * The factory's HighLevel case: a connection with both halves builds the real
 * adapter; anything less is the named no-op, so a destination without a usable
 * connection never reaches the network and the history says what to fix.
 */
import { describe, expect, it, vi } from 'vitest';
import { GOHIGHLEVEL_REASONS } from '@quill/types';
import { createDestination } from './factory';
import type { DestinationContext } from './destination.port';
import { GoHighLevelDestination } from './adapters/gohighlevel';

const ctx: DestinationContext = {
  idempotencyKey: 'submission:s1:complete:gohighlevel:0',
  submissionId: 's1',
  formId: 'f1',
  formName: 'Demo',
  accountId: 'acc-1',
  sessionId: 'sess-1',
  score: 0,
  outcomeLabel: null,
  phase: 'complete',
  submittedAt: 1_000,
  data: { email: 'sam@acme.io' },
  utm: {},
};

describe('createDestination for gohighlevel', () => {
  it('builds the HighLevel adapter when the connection has a token and a location', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ new: true, contact: { id: 'c1' } }),
    })) as unknown as typeof fetch;
    const dest = createDestination(
      {
        type: 'gohighlevel',
        gohighlevel: { credentials: { token: 'pit-example', locationId: 'loc-1' }, fieldMappings: {} },
      },
      fetchImpl,
    );
    expect(dest).toBeInstanceOf(GoHighLevelDestination);
    await expect(dest.deliver(ctx)).resolves.toMatchObject({
      delivered: true,
      driver: 'gohighlevel',
      detail: 'created contact c1',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends the connection trimmed, as it was meant to be pasted', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ new: false, contact: { id: 'c1' } }),
    })) as unknown as typeof fetch;
    await createDestination(
      {
        type: 'gohighlevel',
        gohighlevel: { credentials: { token: ' pit-example ', locationId: ' loc-1 ' }, fieldMappings: {} },
      },
      fetchImpl,
    ).deliver(ctx);
    const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(JSON.parse(String(init.body)).locationId).toBe('loc-1');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer pit-example');
  });

  it('degrades to the named no-op without a usable connection, and never touches the network', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const specs = [
      { type: 'gohighlevel' as const },
      {
        type: 'gohighlevel' as const,
        gohighlevel: { credentials: { token: '', locationId: 'loc-1' }, fieldMappings: {} },
      },
      {
        type: 'gohighlevel' as const,
        gohighlevel: { credentials: { token: 'pit-example', locationId: '  ' }, fieldMappings: {} },
      },
    ];
    for (const spec of specs) {
      const dest = createDestination(spec, fetchImpl);
      expect(dest.type).toBe('log-only');
      await expect(dest.deliver(ctx)).resolves.toEqual({
        delivered: false,
        driver: 'log-only',
        detail: GOHIGHLEVEL_REASONS.notConnected,
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
