/**
 * The visitor's `X-Forwarded-For` chain, for server-side calls made to the
 * public API on a visitor's behalf.
 *
 * The public API rate-limits per client IP (`apps/api/src/rate-limit.ts`). When
 * the web app fetches on behalf of a visitor (RSC page render, Server Actions),
 * the API's socket peer is the web server — so without this header every
 * visitor of every form shares ONE rate-limit bucket, and a burst of visitors
 * (a conference QR moment) exhausts it for everyone at once.
 *
 * The chain is forwarded VERBATIM, never rebuilt: the API resolves the real
 * client entry from the right by its own `TRUST_PROXY_HOPS`, so the header must
 * reach it exactly as the web app's fronting proxy produced it. Appending or
 * reordering entries here would silently shift that math.
 */
import { headers } from 'next/headers';

/** The incoming request's XFF chain, or null outside a request / no proxy. */
export async function forwardedForChain(): Promise<string | null> {
  try {
    const h = await headers();
    return h.get('x-forwarded-for');
  } catch {
    // Outside a request scope (build-time render, tests) there is no visitor
    // to attribute — the caller sends no header and the API keys on the peer.
    return null;
  }
}

/** The chain as ready-to-spread fetch headers ({} when there is none). */
export async function forwardedForHeader(): Promise<Record<string, string>> {
  const chain = await forwardedForChain();
  return chain ? { 'x-forwarded-for': chain } : {};
}
