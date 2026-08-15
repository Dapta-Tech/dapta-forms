import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { fenceMyProfileV2 } from '@/lib/admin-api';

/**
 * Settle ONE public page save whose answer never arrived.
 *
 * Why a Route Handler and not another Server Action: actions from one tab run
 * serially, so the call that would ask "did that save land?" queues behind the
 * very request that is stuck. This runs off that queue, on the same origin,
 * with the same session cookie.
 *
 * What it does is a FENCE, not a read: it advances the member's profile
 * revision without touching content, using the revision the ambiguous save
 * expected. Winning proves that save never landed and never can — its expected
 * revision is now spent. Losing proves something else got there first and
 * returns the authoritative state. A plain reread could not decide either way,
 * because it can overtake the in-flight write and answer with pre-write state.
 *
 * POST only. A GET or HEAD must never mutate.
 *
 * CSRF: the session cookie is httpOnly and SameSite=Lax, so a cross-site form
 * POST does not carry it; this route additionally requires a same-origin
 * `Origin` header. It does not change cookie policy, and it inherits whatever
 * SameSite guarantee the session cookie already provides — a browser that
 * ignored SameSite would still be stopped by the Origin check below.
 */

interface FenceBody {
  expectedRevision?: unknown;
}

const json = (body: unknown, status: number): NextResponse =>
  NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** Same-origin only: compare the Origin's host to the host we were reached on. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ status: 'forbidden' }, 403);

  const body = (await request.json().catch(() => ({}))) as FenceBody;
  const expectedRevision = body.expectedRevision;
  // Only the expectation travels on the wire. No profile, no member id: the
  // principal and account are re-derived per request from the session by the
  // API, through the same `resolveHost` path every other admin call uses.
  if (
    typeof expectedRevision !== 'number' ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0
  ) {
    return json(
      { status: 'failed', message: 'expectedRevision must be a non-negative integer.' },
      400,
    );
  }

  const result = await fenceMyProfileV2(expectedRevision);

  // An expired or missing session answers with a JSON status and the matching
  // HTTP code — never login HTML at 200, which a background caller would parse
  // as success.
  if (result.status === 'unauthorized') return json({ status: 'unauthorized' }, 401);
  if (result.status === 'not_found') return json({ status: 'not_found' }, 404);
  if (result.status === 'unsupported') return json({ status: 'unsupported' }, 409);
  if (result.status === 'failed') return json({ status: 'unknown', message: result.message }, 503);
  if (result.status === 'unknown') return json({ status: 'unknown' }, 503);

  // Settled either way: the stored state moved, so the rendered page is stale.
  revalidatePath('/admin/settings');
  return json(result, 200);
}
