import { getMessages, type Locale } from '@quill/shared';
import { serverApiUrl } from '@/lib/api-url';

/**
 * The permanent file link a webhook payload carries on every file answer
 * (`/file/<token>`), resolved at click time.
 *
 * No session: the token is a signed claim on one file, verified by the API.
 * This handler only asks the API for a fresh short-lived URL and sends the
 * browser there with a 302, so the bucket URL is never stored anywhere and the
 * link itself never expires. The API decides inline or download from the
 * file's extension; this side never looks at the file.
 *
 * `file` is a reserved public slug (`RESERVED_PUBLIC_SLUGS`), so no account can
 * take it as its code and have its pages shadowed by this static segment.
 */

/** Matches the API's ceiling; anything longer is not a token and costs no API call. */
const MAX_TOKEN_LENGTH = 512;
const TOKEN_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Every response here: never cached (the redirect target dies in minutes) and
 * never sent on as a referrer (the token is a bearer secret, and the next hop
 * is the storage host).
 */
const BASE_HEADERS = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex',
} as const;

function localeOf(req: Request): Locale {
  const accept = req.headers.get('accept-language') ?? '';
  return accept.trim().toLowerCase().startsWith('es') ? 'es' : 'en';
}

/** A plain-text answer in the visitor's language. A bare tab needs no more. */
function textResponse(
  req: Request,
  status: number,
  kind: 'notFound' | 'error',
  extra: Record<string, string> = {},
): Response {
  const m = getMessages(localeOf(req)).renderer;
  const body = kind === 'notFound' ? `${m.notFoundTitle}\n\n${m.notFoundBody}` : `${m.errorTitle}\n\n${m.errorBody}`;
  return new Response(body, {
    status,
    headers: { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8', ...extra },
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await ctx.params;
  if (!token || token.length > MAX_TOKEN_LENGTH || !TOKEN_RE.test(token)) {
    return textResponse(req, 404, 'notFound');
  }

  // The visitor's chain, verbatim, so the API's per-IP rate limit buckets the
  // visitor and not this server (see `lib/forwarded-for.ts`).
  const xff = req.headers.get('x-forwarded-for');
  let upstream: Response;
  try {
    upstream = await fetch(`${serverApiUrl}/v1/public/files/${encodeURIComponent(token)}`, {
      cache: 'no-store',
      redirect: 'manual',
      headers: xff ? { 'x-forwarded-for': xff } : {},
    });
  } catch {
    return textResponse(req, 503, 'error');
  }

  if (upstream.status === 404) return textResponse(req, 404, 'notFound');
  if (upstream.status === 429) {
    const retry = upstream.headers.get('retry-after');
    return textResponse(req, 429, 'error', retry ? { 'retry-after': retry } : {});
  }
  if (!upstream.ok) return textResponse(req, 503, 'error');

  let target: unknown;
  try {
    target = ((await upstream.json()) as { url?: unknown }).url;
  } catch {
    return textResponse(req, 503, 'error');
  }
  if (typeof target !== 'string' || !/^https?:\/\//i.test(target)) return textResponse(req, 503, 'error');

  return new Response(null, { status: 302, headers: { ...BASE_HEADERS, location: target } });
}
