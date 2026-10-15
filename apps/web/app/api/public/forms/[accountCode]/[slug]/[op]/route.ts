import {
  MAX_PUBLIC_FORM_BODY_BYTES,
  isPublicFormOp,
  relayPublicFormCall,
} from '@/lib/public-form-relay';

/**
 * The public form's stable endpoint: `POST /api/public/forms/:accountCode/:slug/:op`
 * with `op` one of `submissions`, `events`, `booking`, `uploads`.
 *
 * It replaces the Server Actions the renderers used to call, whose compiled ids
 * change with every deploy and strand an open tab (see `lib/public-form-relay.ts`).
 * This address is the same in every build, so a form opened before a deploy
 * finishes against the new one.
 *
 * Unauthenticated, like the API endpoints it relays to; it adds no authority
 * of its own. A JSON content type is required, which a cross-site page cannot
 * send without a CORS preflight this route never grants.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ accountCode: string; slug: string; op: string }> },
): Promise<Response> {
  const { accountCode, slug, op } = await ctx.params;
  if (!isPublicFormOp(op)) return Response.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });

  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return Response.json({ ok: false, error: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 });
  }
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_PUBLIC_FORM_BODY_BYTES) return tooLarge();
  // Counted while it streams in, so a body that understates (or omits) its
  // length is cut off at the ceiling instead of being buffered whole.
  const text = await readCapped(req, MAX_PUBLIC_FORM_BODY_BYTES);
  if (text === null) return tooLarge();

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
    const result = await relayPublicFormCall(
      op,
      accountCode,
      slug,
      body as Record<string, unknown>,
    );
    return Response.json(result.body, {
      status: result.status,
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    // The API could not be reached. Not a verdict: the browser may try again
    // (submissions only; the booking record is never retried).
    return Response.json({ ok: false, error: 'UPSTREAM_UNAVAILABLE' }, { status: 502 });
  }
}

function tooLarge(): Response {
  return Response.json({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
}

/** The body as text, or null as soon as it passes `limit` bytes. */
async function readCapped(req: Request, limit: number): Promise<string | null> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
