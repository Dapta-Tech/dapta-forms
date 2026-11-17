/**
 * The factory's HighLevel case while no adapter exists: every delivery is the
 * named no-op, so a stored `gohighlevel` destination can never reach the
 * network and the history says what to fix instead of "unknown type".
 */
import { describe, expect, it, vi } from 'vitest';
import { GOHIGHLEVEL_REASONS } from '@quill/types';
import { createDestination } from './factory';
import type { DestinationContext } from './destination.port';

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
  it('degrades to the named no-op, with or without credentials, and never touches the network', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const specs = [
      { type: 'gohighlevel' as const },
      {
        type: 'gohighlevel' as const,
        gohighlevel: { credentials: { token: 'pit-example', locationId: 'loc-1' }, fieldMappings: {} },
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
