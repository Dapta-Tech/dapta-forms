/**
 * Safe invocation of a Next.js server action from client code.
 *
 * A server action's own try/catch handles errors that happen ON the server —
 * those come back as a value (`{ ok: false, message }`). What it cannot handle
 * is the invocation itself failing on the CLIENT: the network dropping, the
 * request hanging, or a deploy rotating the compiled action ids while a tab is
 * open ("Failed to find Server Action"). Those reject the returned promise, and
 * an unguarded `await someAction()` then skips every state update after it —
 * which is exactly how the editor froze on "Saving…" with no retry and no log.
 *
 * `callAction` turns that transport failure into a value too, so a call site
 * always gets a result it can branch on:
 *
 *   const res = await callAction(() => saveFormAction(id, patch));
 *   if (isTransportError(res)) …  // did not reach the server — safe to retry
 *   else if (!res.ok) …           // the server said no
 *
 * Client components must invoke server actions through this wrapper — never
 * with a bare `await`/`void`. An eslint restriction under app/admin enforces it.
 */

export interface TransportError {
  ok: false;
  /** Discriminant: the call never produced a server verdict. Always retryable. */
  transport: true;
  message: string;
}

export const isTransportError = (r: unknown): r is TransportError =>
  typeof r === 'object' && r !== null && (r as TransportError).transport === true;

/** Per-attempt ceiling. Server actions from one tab run serially, so a hung
 *  call would otherwise queue every later action (publish included) forever. */
const DEFAULT_TIMEOUT_MS = 15_000;

export async function callAction<T>(
  fn: () => Promise<T>,
  opts?: { timeoutMs?: number },
): Promise<T | TransportError> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } catch (e) {
    return {
      ok: false,
      transport: true,
      message: e instanceof Error ? e.message : 'network error',
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
