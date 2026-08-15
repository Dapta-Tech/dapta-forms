import type { Db } from '../client';

export async function withDb<T>(
  tag: string,
  db: Db,
  operation: (db: Db) => Promise<T>,
): Promise<T> {
  let failed = false;
  let closeFailed = false;
  let closeError: unknown;
  let result: T;
  try {
    result = await operation(db);
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    try {
      await db.close();
    } catch (closeErr) {
      if (failed) {
        console.error(`[${tag}] close failed (secondary; the original failure follows):`, closeErr);
      } else {
        closeFailed = true;
        closeError = closeErr;
      }
    }
  }
  if (closeFailed) throw closeError;
  return result;
}
