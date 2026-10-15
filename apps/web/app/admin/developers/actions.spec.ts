/**
 * The two writes behind the Developers page, against the `/v1/api-keys`
 * contract. The API is mocked: these pin what the page is handed back, which
 * is a stable code it can localize, never a raw server string, and the full
 * key exactly once, on create.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createApiKey = vi.fn();
const revokeApiKey = vi.fn();
const revalidatePath = vi.fn();

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
    adminApi: {
      createApiKey: (...a: unknown[]) => createApiKey(...a),
      revokeApiKey: (...a: unknown[]) => revokeApiKey(...a),
    },
  };
});
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => undefined }));

import { ApiError } from '@/lib/admin-api';
import { createApiKeyAction, revokeApiKeyAction } from './actions';

const created = {
  id: 'key-1',
  name: 'Claude Code',
  last4: 'a1b2',
  createdAt: 1_760_000_000_000,
  key: 'dforms_example_secret_a1b2',
};

describe('createApiKeyAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hands back the full key once and refreshes the page', async () => {
    createApiKey.mockResolvedValue(created);
    await expect(createApiKeyAction('  Claude Code  ')).resolves.toEqual({ ok: true, key: created });
    expect(createApiKey).toHaveBeenCalledWith('Claude Code');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/developers/keys');
  });

  it('refuses a blank name or one over 60 characters without calling the API', async () => {
    await expect(createApiKeyAction('   ')).resolves.toEqual({ ok: false, code: 'INVALID' });
    await expect(createApiKeyAction('x'.repeat(61))).resolves.toEqual({ ok: false, code: 'INVALID' });
    expect(createApiKey).not.toHaveBeenCalled();
  });

  it('accepts a name of exactly 60 characters', async () => {
    createApiKey.mockResolvedValue(created);
    await expect(createApiKeyAction('x'.repeat(60))).resolves.toMatchObject({ ok: true });
  });

  it('turns the eleventh key into KEY_LIMIT', async () => {
    createApiKey.mockRejectedValue(new ApiError(409, 'limit', 'KEY_LIMIT'));
    await expect(createApiKeyAction('One more')).resolves.toEqual({ ok: false, code: 'KEY_LIMIT' });
  });

  it('maps the other refusals to stable codes', async () => {
    createApiKey.mockRejectedValueOnce(new ApiError(400, 'bad', 'BAD_REQUEST'));
    await expect(createApiKeyAction('a')).resolves.toEqual({ ok: false, code: 'INVALID' });
    createApiKey.mockRejectedValueOnce(new ApiError(403, 'no', 'FORBIDDEN'));
    await expect(createApiKeyAction('a')).resolves.toEqual({ ok: false, code: 'FORBIDDEN' });
    createApiKey.mockRejectedValueOnce(new ApiError(500, 'boom'));
    await expect(createApiKeyAction('a')).resolves.toEqual({ ok: false, code: 'FAILED' });
    createApiKey.mockRejectedValueOnce(new Error('network'));
    await expect(createApiKeyAction('a')).resolves.toEqual({ ok: false, code: 'FAILED' });
  });

  it('refuses anything that is not a string', async () => {
    await expect(createApiKeyAction(42 as unknown as string)).resolves.toEqual({ ok: false, code: 'INVALID' });
    expect(createApiKey).not.toHaveBeenCalled();
  });
});

describe('revokeApiKeyAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('revokes and refreshes the page', async () => {
    revokeApiKey.mockResolvedValue(undefined);
    await expect(revokeApiKeyAction('key-1')).resolves.toEqual({ ok: true });
    expect(revokeApiKey).toHaveBeenCalledWith('key-1');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/developers/keys');
  });

  it('never reports a 404 as a revoke, and refreshes the list', async () => {
    // 404 also means "a key of another workspace" (the cookie changed in another
    // tab), where the key is still alive: saying "revoked" would be a lie.
    revokeApiKey.mockRejectedValue(new ApiError(404, 'gone', 'NOT_FOUND'));
    await expect(revokeApiKeyAction('key-1')).resolves.toEqual({ ok: false, code: 'GONE' });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/developers/keys');
  });

  it('says FORBIDDEN when the key belongs to someone else', async () => {
    revokeApiKey.mockRejectedValue(new ApiError(403, 'no', 'FORBIDDEN'));
    await expect(revokeApiKeyAction('key-2')).resolves.toEqual({ ok: false, code: 'FORBIDDEN' });
  });

  it('says FAILED for anything else, and never calls the API without an id', async () => {
    revokeApiKey.mockRejectedValue(new Error('network'));
    await expect(revokeApiKeyAction('key-1')).resolves.toEqual({ ok: false, code: 'FAILED' });
    revokeApiKey.mockClear();
    await expect(revokeApiKeyAction('')).resolves.toEqual({ ok: false, code: 'FAILED' });
    expect(revokeApiKey).not.toHaveBeenCalled();
  });
});
