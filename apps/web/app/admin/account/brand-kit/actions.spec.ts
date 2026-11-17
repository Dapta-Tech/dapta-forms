/**
 * `saveAttributionAction`, the two ways a save fails: a 403
 * `DAPTA_SUBSCRIPTION_REQUIRED` comes back with the row as the server now
 * has it (so the switch can grey out), anything else with no state at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
const api = vi.hoisted(() => ({ setAttribution: vi.fn(), attributionStatus: vi.fn() }));
vi.mock('@/lib/admin-api', () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly code?: string,
    ) {
      super(message);
    }
  }
  return { ApiError, adminApi: api };
});

import { ApiError } from '@/lib/admin-api';
import { saveAttributionAction } from './actions';

const NOT_PAID = { hideAttribution: false, canHide: false, showing: true };

beforeEach(() => vi.clearAllMocks());

describe('saveAttributionAction', () => {
  it('a 403 DAPTA_SUBSCRIPTION_REQUIRED returns its code and the server state', async () => {
    api.setAttribution.mockRejectedValue(new ApiError(403, 'only subscribers', 'DAPTA_SUBSCRIPTION_REQUIRED'));
    api.attributionStatus.mockResolvedValue(NOT_PAID);
    expect(await saveAttributionAction(true)).toEqual({
      ok: false,
      message: 'only subscribers',
      code: 'DAPTA_SUBSCRIPTION_REQUIRED',
      status: NOT_PAID,
    });
  });

  it('the refusal still comes back when the state cannot be read', async () => {
    api.setAttribution.mockRejectedValue(new ApiError(403, 'only subscribers', 'DAPTA_SUBSCRIPTION_REQUIRED'));
    api.attributionStatus.mockRejectedValue(new Error('down'));
    const r = await saveAttributionAction(true);
    expect(r).toMatchObject({ ok: false, code: 'DAPTA_SUBSCRIPTION_REQUIRED' });
    expect(r).not.toHaveProperty('status');
  });

  it('any other error reads no state', async () => {
    api.setAttribution.mockRejectedValue(new ApiError(403, 'Requires an admin or owner.', 'FORBIDDEN'));
    const r = await saveAttributionAction(true);
    expect(r).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(r).not.toHaveProperty('status');
    expect(api.attributionStatus).not.toHaveBeenCalled();
  });
});
