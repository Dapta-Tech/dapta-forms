import { postLinkPageEvent } from '@/lib/api';

/**
 * `POST /api/public/pages/:accountCode/events` (the default page) and
 * `POST /api/public/pages/:accountCode/:pageSlug/events` (any other page): a
 * link page view or click, relayed to the API (which validates it, names the
 * page in the capture and enqueues it).
 *
 * Same contract as the public form's event route: a same-origin address that
 * does not change between deploys, a JSON content type (which a cross-site
 * page cannot send without a preflight this route never grants), a small
 * body, and the visitor's `X-Forwarded-For` passed on for the API's per-IP
 * rate limit. Best-effort: the browser never waits on the answer.
 */
const MAX_BODY_BYTES = 2_000;

export async function relayLinkPageEvent(req: Request, accountCode: string, pageSlug: string | null): Promise<Response> {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return Response.json({ ok: false, error: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 });
  }
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return Response.json({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ ok: false, error: 'BAD_REQUEST' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ ok: false, error: 'BAD_REQUEST' }, { status: 400 });
  }
  try {
    const status = await postLinkPageEvent(accountCode, body as Parameters<typeof postLinkPageEvent>[1], pageSlug);
    return Response.json({ ok: status < 300 }, { status: status < 300 ? 202 : status, headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ ok: false, error: 'UPSTREAM_UNAVAILABLE' }, { status: 502 });
  }
}
