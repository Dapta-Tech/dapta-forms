/**
 * Which deployment an analytics event came from, derived from the public host.
 *
 * Several deployments can ship their telemetry into ONE analytics project (a
 * development and a production install often share it), and without a tag
 * their events merge into the same funnels. Every product event therefore
 * carries `environment`, on the server (`AnalyticsCapture`) and in the browser
 * (a super property registered at init).
 *
 * Read from the host of `PUBLIC_APP_URL` rather than from a new variable:
 * every real deployment already sets that URL, while `NODE_ENV` is
 * `production` on any built image, staging included. Nothing to configure, so
 * a fork is tagged correctly the day it deploys.
 */
export type DeploymentEnvironment = 'prd' | 'dev' | 'local';

/**
 * Host labels that mark a non-production deployment wherever they sit in the
 * name, so `app.dev.example.com` and `forms.example.dev` both match. A label
 * must BE the marker: `staging-forms.example.com` does not match.
 */
const NON_PRODUCTION_LABELS = new Set([
  'dev',
  'development',
  'staging',
  'stage',
  'stg',
  'qa',
  'uat',
  'test',
  'sandbox',
  'preview',
]);

/** Top-level names that never resolve on the public internet (RFC 2606, RFC 6761, mDNS). */
const LOCAL_TLDS = new Set(['localhost', 'local', 'test', 'internal']);

const LOCAL_HOSTS = new Set(['127.0.0.1', '0.0.0.0', '[::1]']);

/** Scheme, then the authority up to the path, query or fragment. */
const HTTP_AUTHORITY = /^https?:\/\/([^/?#\s]+)/i;

/**
 * The lowercased hostname of an http(s) URL, or null when there is none.
 * String-parsed (no `URL`): this package stays lib-ES2022-only.
 */
export function deploymentHost(publicAppUrl: string | null | undefined): string | null {
  if (typeof publicAppUrl !== 'string') return null;
  const authority = HTTP_AUTHORITY.exec(publicAppUrl.trim())?.[1];
  if (!authority) return null;
  // Drop any `user:pass@`, then the port. An IPv6 literal keeps its brackets.
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  const host = hostPort.startsWith('[')
    ? hostPort.slice(0, hostPort.indexOf(']') + 1)
    : hostPort.split(':')[0]!;
  const lowered = host.toLowerCase().replace(/\.$/, '');
  return lowered.length > 0 ? lowered : null;
}

/**
 * `local` with no public URL (a bare clone) or a loopback / reserved host;
 * `dev` when any label of the host is a non-production marker; `prd`
 * otherwise. Pure, so both apps reach the same verdict from the same URL.
 */
export function deploymentEnvironment(publicAppUrl: string | null | undefined): DeploymentEnvironment {
  const host = deploymentHost(publicAppUrl);
  if (!host || LOCAL_HOSTS.has(host)) return 'local';
  const labels = host.split('.');
  if (LOCAL_TLDS.has(labels[labels.length - 1]!)) return 'local';
  // An IPv4 literal other than loopback is an operator reaching the box by
  // address, which is never the public production name.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return 'local';
  return labels.some((label) => NON_PRODUCTION_LABELS.has(label)) ? 'dev' : 'prd';
}
