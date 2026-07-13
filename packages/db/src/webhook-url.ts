/**
 * Webhook subscriber-URL guard (anti-SSRF). Subscriber URLs are attacker-
 * controlled and fetched server-side by dispatchWebhooks, so an unvalidated URL
 * lets a tenant point us at cloud metadata (169.254.169.254), loopback, or an
 * internal service. This enforces: https-only, no internal/loopback/link-local
 * hostnames, and — for DNS names — rejection if ANY resolved address is private
 * (DNS-rebinding defense). The resolver is injectable for tests.
 */
import { lookup as dnsLookup } from 'node:dns/promises';

export interface UrlCheck {
  ok: boolean;
  reason?: string;
}

type Lookup = (
  hostname: string,
  opts: { all: true },
) => Promise<Array<{ address: string; family: number }>>;

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata']);
const BLOCKED_SUFFIXES = ['.internal', '.local', '.localhost'];

/** Any non-globally-routable / special-use IPv4 range. Malformed → treated as private. */
export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

export function isPrivateIpv6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === '::1' || s === '::') return true; // loopback / unspecified
  if (s.startsWith('fe80')) return true; // link-local
  if (s.startsWith('fc') || s.startsWith('fd')) return true; // unique-local fc00::/7
  if (s.startsWith('::ffff:')) return isPrivateIpv4(s.slice('::ffff:'.length)); // v4-mapped
  return false;
}

function looksLikeIp(host: string): boolean {
  return /^[0-9.]+$/.test(host) || host.includes(':');
}

function isPrivateLiteral(host: string): boolean {
  return host.includes(':') ? isPrivateIpv6(host) : isPrivateIpv4(host);
}

/**
 * Validate a webhook subscriber URL. Returns `{ ok: false, reason }` for any
 * URL we refuse to call, so the caller can surface a 400 and dispatch can skip.
 */
export async function checkWebhookUrl(
  raw: string,
  resolver: Lookup = dnsLookup as unknown as Lookup,
): Promise<UrlCheck> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'must_be_https' };

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return { ok: false, reason: 'invalid_host' };
  if (
    BLOCKED_HOSTNAMES.has(host) ||
    BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))
  )
    return { ok: false, reason: 'blocked_host' };

  // IP literal — check directly, no DNS.
  if (looksLikeIp(host)) {
    return isPrivateLiteral(host) ? { ok: false, reason: 'private_ip' } : { ok: true };
  }

  // DNS name — resolve and reject if ANY address is private (rebinding defense).
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await resolver(host, { all: true });
  } catch {
    return { ok: false, reason: 'unresolvable' };
  }
  if (!addrs.length) return { ok: false, reason: 'unresolvable' };
  for (const a of addrs) {
    const priv = a.family === 6 ? isPrivateIpv6(a.address) : isPrivateIpv4(a.address);
    if (priv) return { ok: false, reason: 'resolves_to_private_ip' };
  }
  return { ok: true };
}
