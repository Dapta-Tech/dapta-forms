import { isIP } from 'node:net';

/**
 * SSRF egress guard for outbound webhook delivery (H1).
 *
 * A form admin configures the webhook URL, and the API pod (running INSIDE the
 * cluster) is what POSTs to it — so an unguarded destination is a server-side
 * request forgery primitive: `https://169.254.169.254/…` (cloud metadata),
 * `https://10.x`, an internal cluster hostname, or a DNS name that RESOLVES to a
 * private address (DNS rebind). We resolve the host and reject any private,
 * loopback, link-local, or unique-local address BEFORE the request is made.
 * `http://localhost` is permitted only when `allowLocalhost` is set (non-prod).
 */

/** Resolve a hostname to its IP addresses (A/AAAA). Injectable for tests. */
export type DnsResolver = (hostname: string) => Promise<string[]>;

/** Default resolver — Node DNS `lookup` (honors /etc/hosts + system resolver). */
export const defaultDnsResolver: DnsResolver = async (hostname) => {
  const { lookup } = await import('node:dns/promises');
  const results = await lookup(hostname, { all: true });
  return results.map((r) => r.address);
};

/** IPv4 loopback (127/8). */
function isV4Loopback(o: number[]): boolean {
  return o[0] === 127;
}

/** IPv4 private / link-local / reserved ranges (excluding loopback). */
function isV4PrivateNonLoopback(o: number[]): boolean {
  const [a, b] = o;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b! >= 16 && b! <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local incl. 169.254.169.254 metadata)
  if (a === 100 && b! >= 64 && b! <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a === 0) return true; // 0.0.0.0/8 ("this host")
  if (a! >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

function parseV4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

/**
 * Classify an IP literal. Returns `'loopback'` (127/8, ::1), `'blocked'`
 * (private / link-local / ULA / reserved), or `'public'`.
 */
export function classifyIp(ip: string): 'loopback' | 'blocked' | 'public' {
  const kind = isIP(ip);
  if (kind === 4) {
    const o = parseV4(ip);
    if (!o) return 'blocked';
    if (isV4Loopback(o)) return 'loopback';
    return isV4PrivateNonLoopback(o) ? 'blocked' : 'public';
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    // IPv4-mapped / -compatible (::ffff:a.b.c.d) — classify the embedded v4.
    const mapped = lower.match(/(?:::ffff:|::)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return classifyIp(mapped[1]!);
    if (lower === '::1') return 'loopback';
    if (lower === '::' ) return 'blocked'; // unspecified
    if (lower.startsWith('fe80') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb'))
      return 'blocked'; // fe80::/10 link-local
    const firstByte = parseInt(lower.split(':')[0]?.padStart(4, '0').slice(0, 2) || '0', 16);
    if ((firstByte & 0xfe) === 0xfc) return 'blocked'; // fc00::/7 unique-local
    return 'public';
  }
  return 'blocked'; // not a valid IP literal
}

/**
 * Assert an outbound URL is safe to POST to. Throws on any blocked target.
 * `allowLocalhost` (non-production) permits loopback destinations so a developer
 * can test against a local catcher.
 */
export async function assertPublicWebhookUrl(
  rawUrl: string,
  opts: { allowLocalhost: boolean; resolve?: DnsResolver },
): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('webhook delivery blocked: malformed URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`webhook delivery blocked: protocol ${url.protocol} not allowed`);
  }
  // Strip IPv6 brackets from the hostname for classification.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const resolve = opts.resolve ?? defaultDnsResolver;

  // Collect the set of IPs this request could actually reach.
  let ips: string[];
  if (isIP(host)) {
    ips = [host];
  } else if (host.toLowerCase() === 'localhost') {
    // `localhost` resolves to loopback regardless of DNS.
    if (!opts.allowLocalhost) {
      throw new Error('webhook delivery blocked: localhost is not permitted in production');
    }
    return;
  } else {
    try {
      ips = await resolve(host);
    } catch (err) {
      throw new Error(`webhook delivery blocked: DNS resolution failed for ${host}: ${String(err)}`);
    }
    if (ips.length === 0) {
      throw new Error(`webhook delivery blocked: ${host} did not resolve to any address`);
    }
  }

  for (const ip of ips) {
    const klass = classifyIp(ip);
    if (klass === 'loopback') {
      if (!opts.allowLocalhost) {
        throw new Error(`webhook delivery blocked: ${host} resolves to loopback ${ip}`);
      }
    } else if (klass === 'blocked') {
      throw new Error(`webhook delivery blocked: ${host} resolves to private/reserved address ${ip}`);
    }
  }
}
