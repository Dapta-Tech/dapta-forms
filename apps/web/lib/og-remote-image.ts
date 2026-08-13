/**
 * Fetching an author-supplied image for the share card — their logo, or the
 * photograph behind their form.
 *
 * The form page never needs this: it emits an `<img src>` and the RESPONDENT's
 * browser does the fetching. A rasterized card has no browser, so the server
 * fetches instead, and that difference is the whole reason this file is careful.
 * Three separate things can go wrong, and none of them may take the card down:
 *
 *  1. **Format.** Satori decodes PNG, JPEG, GIF and SVG. It cannot decode WebP —
 *     it fails with `Unsupported image type: image/webp` — and WebP is what most
 *     CMSs (WordPress above all) hand out today. So the type is checked and an
 *     undecodable file is DROPPED rather than passed on to throw mid-render.
 *  2. **Time.** A slow origin would hold a social crawler open until it gives up
 *     and shows no card at all, which is worse than a card without the logo.
 *  3. **Reach.** The URL is author-controlled and we now resolve it from inside
 *     the cluster, so it is a server-side request forgery surface the `<img>`
 *     version never was. Loopback and private ranges are refused.
 *
 * Every failure path returns null and the caller draws the card without it.
 */

/** Satori's decoders. WebP and AVIF are absent because it has none. */
const DECODABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml']);

const FETCH_TIMEOUT_MS = 2_500;
const MAX_BYTES = 1_500_000;

/** Hostnames that must never be reachable from a request an author composed. */
const BLOCKED_HOST = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /\.internal$/i,
  /\.local$/i,
];

function isFetchable(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (BLOCKED_HOST.some((re) => re.test(url.hostname))) return null;
  return url;
}

/**
 * The image as a `data:` URI Satori can draw, or null when it cannot be used.
 *
 * Returns a data URI rather than the original URL on purpose: Satori would
 * otherwise fetch it a second time itself, with none of the guards above.
 */
export async function remoteImageDataUri(raw: string | null | undefined): Promise<string | null> {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const url = isFetchable(trimmed);
  if (!url) return null;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      // The card is cached by whoever renders it; re-validating the author's
      // asset on every crawl would multiply their bandwidth by our traffic.
      cache: 'force-cache',
    });
    if (!res.ok) return null;

    const type = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!DECODABLE.has(type)) return null;

    // Content-Length is a hint, not a promise, so the body is measured too.
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > MAX_BYTES) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_BYTES) return null;

    return `data:${type};base64,${buffer.toString('base64')}`;
  } catch {
    // Timeout, DNS failure, TLS failure, aborted body — all the same answer.
    return null;
  }
}
