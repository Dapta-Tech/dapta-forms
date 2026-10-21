import { cleanPublicUrl as clean } from './public-url';

/**
 * The API address a CUSTOMER should call, as opposed to the one this server
 * calls (`serverApiUrl`).
 *
 * The two differ in a real deployment. `API_URL` exists so server-to-server
 * calls can stay inside the cluster, which means it may name an address that
 * only resolves there; printing it in the Developers docs, or baking it into
 * the skill zip, would hand an agent a host it can never reach. So:
 *
 * 1. `PUBLIC_API_URL`, read at runtime like `API_URL` (no `NEXT_PUBLIC_`
 *    prefix, so one built image serves every environment). This is the knob a
 *    deployment sets.
 * 2. `API_URL`, when it does not look cluster-internal. A fork that runs the
 *    API on a public host usually points the web at that same host.
 * 3. `NEXT_PUBLIC_API_URL`, read from the RUNTIME environment. It is read off
 *    the `env` object passed in, never as a literal `process.env.NEXT_PUBLIC_*`
 *    expression, so Next does not inline the build-time value here. A
 *    deployment that already sets it per environment (alongside a
 *    cluster-internal `API_URL`) therefore needs no new variable.
 * 4. `http://localhost:4000` when none of the three is set, the same default
 *    `serverApiUrl` uses for a bare clone.
 *
 * Null when the variables are set but none of them is usable: the docs then say
 * so instead of guessing, and the skill route refuses rather than ship a zip
 * that points nowhere.
 */
export function publicApiUrl(env: Record<string, string | undefined> = process.env): string | null {
  const explicit = clean(env.PUBLIC_API_URL);
  if (explicit) return explicit;

  const server = clean(env.API_URL);
  if (server && !looksInternal(server)) return server;

  const runtimePublic = clean(env.NEXT_PUBLIC_API_URL);
  if (runtimePublic && !looksInternal(runtimePublic)) return runtimePublic;

  // Something is configured but none of it is reachable from outside.
  if (env.API_URL?.trim() || env.NEXT_PUBLIC_API_URL?.trim()) return null;

  return 'http://localhost:4000';
}

/**
 * A host only a cluster or a private network can resolve: a single label that
 * is not `localhost` (a Docker Compose or Kubernetes service name), or one of
 * the suffixes those networks use.
 */
function looksInternal(url: string): boolean {
  const host = new URL(url).hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return false;
  // Private and link-local addresses (a Docker bridge, a VPC): dotted, so the
  // single-label rule below would wave them through.
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  if (/^\[(f[cd]|fe[89ab])/.test(host)) return true;
  if (!host.includes('.')) return true;
  return /\.(local|internal|svc|cluster\.local|localdomain)$/.test(host);
}
