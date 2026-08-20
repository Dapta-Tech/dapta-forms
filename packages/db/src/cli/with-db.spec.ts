import type { Db } from '../client';
import { describe, expect, it, vi } from 'vitest';
import { withDb } from './with-db';

function dbWithClose(close: () => Promise<void>): Db {
  return { close } as Db;
}

describe('withDb', () => {
  it('returns the exact operation result when operation and close succeed', async () => {
    const result = { state: 'operation result' };
    const close = vi.fn(async () => undefined);

    await expect(withDb('migrate', dbWithClose(close), async () => result)).resolves.toBe(result);
    expect(close).toHaveBeenCalledOnce();
  });

  it('rethrows a synchronous SQLite-shaped close error after a successful operation', async () => {
    const closeError = new Error('SQLite close failed');
    const close = vi.fn(() => {
      throw closeError;
    });

    await expect(withDb('migrate', dbWithClose(close), async () => undefined)).rejects.toBe(closeError);
    expect(close).toHaveBeenCalledOnce();
  });

  it('preserves the exact operation error when close succeeds', async () => {
    const operationError = { state: 'operation failed' };
    const close = vi.fn(async () => undefined);

    await expect(
      withDb('migrate', dbWithClose(close), async () => {
        throw operationError;
      }),
    ).rejects.toBe(operationError);
    expect(close).toHaveBeenCalledOnce();
  });

  it('preserves the operation error and reports a rejected close error as secondary', async () => {
    const operationError = { state: 'operation failed' };
    const closeError = new Error('Postgres close failed');
    const close = vi.fn(() => Promise.reject(closeError));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(
        withDb('migrate', dbWithClose(close), async () => {
          throw operationError;
        }),
      ).rejects.toBe(operationError);
      expect(close).toHaveBeenCalledOnce();
      expect(error).toHaveBeenCalledWith(
        '[migrate] close failed (secondary; the original failure follows):',
        closeError,
      );
    } finally {
      error.mockRestore();
    }
  });
});
