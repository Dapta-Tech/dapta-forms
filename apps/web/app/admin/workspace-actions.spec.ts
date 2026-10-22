/**
 * Staff entering a workspace of the whole deployment: what the cards are
 * handed back when the API refuses. A membership of their own that is not
 * active (disabled by the owner, or still an invitation) is its own answer,
 * so the person is told why instead of a bare "no permission".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const enterEstateWorkspace = vi.fn();

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
  return {
    ApiError,
    adminApi: { enterEstateWorkspace: (...a: unknown[]) => enterEstateWorkspace(...a) },
  };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), unstable_rethrow: vi.fn() }));
vi.mock('@/lib/auth-session', () => ({ setWorkspace: vi.fn() }));

import { ApiError } from '@/lib/admin-api';
import { enterEstateWorkspaceAction } from './workspace-actions';

describe('enterEstateWorkspaceAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('says when their own membership there is not active', async () => {
    enterEstateWorkspace.mockRejectedValue(new ApiError(403, 'not active', 'MEMBERSHIP_NOT_ACTIVE'));
    await expect(enterEstateWorkspaceAction('ws-1')).resolves.toEqual({ error: 'membership_not_active' });
  });

  it('keeps every other refusal a plain forbidden', async () => {
    enterEstateWorkspace.mockRejectedValueOnce(new ApiError(403, 'no', 'WORKSPACE_FORBIDDEN'));
    await expect(enterEstateWorkspaceAction('ws-1')).resolves.toEqual({ error: 'forbidden' });
    enterEstateWorkspace.mockRejectedValueOnce(new Error('network'));
    await expect(enterEstateWorkspaceAction('ws-1')).resolves.toEqual({ error: 'forbidden' });
  });
});
