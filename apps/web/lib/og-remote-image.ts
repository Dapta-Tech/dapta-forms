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
 *     version never was. The hostname is checked, then RESOLVED, and any
 *     loopback / private / link-local / unique-local address is refused —
 *     matching the `ssrf-guard` the webhook adapter sets as this repo's
 *     standard (a name check alone lets a public DNS name point inward).
 *     Redirects are refused outright (`redirect: 'error'`): following one
 *     would land on a hostname none of these checks ever saw, and a card is
 *     better missing a logo than fetching where a Location header aims it.
 *
 * Every failure path returns null and the caller draws the card without it.
 */
import { isIP } from 'node:net';

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

/** Resolve a hostname to its addresses (A/AAAA). Injectable for tests. */
export type OgDnsResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: OgDnsResolver = async (hostname) => {
  const { lookup } = await import('node:dns/promises');
  const results = await lookup(hostname, { all: true });
  return results.map((r) => r.address);
};

/**
 * True for an address this server may fetch from on an author's behalf —
 * public unicast only. Same classification as `ssrf-guard` in
 * `@quill/destinations` (not imported: that package is API-side and carries
 * the adapters; the web app only needs these thirty lines).
 */
function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const o = ip.split('.').map(Number);
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [a, b] = o as [number, number, number, number];
    if (a === 127 || a === 10 || a === 0) return false; // loopback, private, "this host"
    if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
    if (a === 192 && b === 168) return false; // 192.168.0.0/16
    if (a === 169 && b === 254) return false; // link-local incl. cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a >= 224) return false; // multicast + reserved
    return true;
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    // IPv4-mapped — classify the embedded v4. Both spellings reach here:
    // dotted (::ffff:10.0.0.5) from DNS answers, and the hex pair the WHATWG
    // URL parser canonicalizes hostnames to (::ffff:a00:5).
    const mappedDotted = lower.match(/(?:::ffff:|::)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mappedDotted) return isPublicAddress(mappedDotted[1]!);
    const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1]!, 16);
      const lo = parseInt(mappedHex[2]!, 16);
      return isPublicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (lower === '::1' || lower === '::') return false; // loopback, unspecified
    if (/^fe[89ab]/.test(lower)) return false; // fe80::/10 link-local
    const firstByte = parseInt(lower.split(':')[0]?.padStart(4, '0').slice(0, 2) || '0', 16);
    if ((firstByte & 0xfe) === 0xfc) return false; // fc00::/7 unique-local
    return true;
  }
  return false;
}

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
 * The hostname's real targets, all of them public — or false. An IP literal is
 * its own target; a DNS name is looked up so a public-looking name that
 * resolves inward (DNS rebinding's first half) is refused before any request.
 */
async function reachesOnlyPublicAddresses(url: URL, resolve: OgDnsResolver): Promise<boolean> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return isPublicAddress(host);
  try {
    const ips = await resolve(host);
    return ips.length > 0 && ips.every(isPublicAddress);
  } catch {
    // NXDOMAIN / resolver failure — the fetch could not succeed anyway.
    return false;
  }
}

/**
 * The image as a `data:` URI Satori can draw, or null when it cannot be used.
 *
 * Returns a data URI rather than the original URL on purpose: Satori would
 * otherwise fetch it a second time itself, with none of the guards above.
 */
export async function remoteImageDataUri(
  raw: string | null | undefined,
  opts?: { resolve?: OgDnsResolver },
): Promise<string | null> {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const url = isFetchable(trimmed);
  if (!url) return null;
  if (!(await reachesOnlyPublicAddresses(url, opts?.resolve ?? defaultResolver))) return null;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      // A redirect would move the request to a hostname the guards above never
      // examined — refuse rather than re-validate hop by hop.
      redirect: 'error',
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
