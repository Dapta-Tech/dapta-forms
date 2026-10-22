/**
 * The WorkOS AuthKit adapter of the MCP OAuth port, selected by
 * `MCP_OAUTH_PROVIDER=workos`. The only place that knows AuthKit's layout:
 * the issuer is the AuthKit domain, its signing keys are published at
 * `/oauth2/jwks`, and it is the authorization server clients log in with
 * (dynamic client registration, consent and tokens all happen there).
 *
 * The rules are the ones the sibling MCP server applies to the same tokens:
 * RS256 against the issuer's keys, `iss` the configured domain, `aud` the
 * configured resource, `sub` and `exp` required. Every value comes from the
 * environment; no host or id of the hosted deployment is written here.
 */
import type { McpOAuthConfig } from '@quill/config/env';
import { IssuerUnavailable, RemoteJwks, verifyRs256 } from './jwt-rs256';
import type { McpOAuth, McpOAuthDeps } from './mcp-oauth';

/** How long the authorization server metadata is reused before it is read again. */
const AS_METADATA_MAX_AGE_MS = 10 * 60_000;
/** While AuthKit cannot be read, how long the stale copy is served before it is tried again. */
const AS_METADATA_RETRY_MS = 30_000;

export function createWorkosAuthKit(config: McpOAuthConfig, deps: McpOAuthDeps = {}): McpOAuth {
  const jwks = new RemoteJwks(`${config.issuer}/oauth2/jwks`, { fetch: deps.fetch });
  let asMetadata: { at: number; body: Record<string, unknown> } | null = null;
  let asInFlight: Promise<Record<string, unknown>> | null = null;

  /** AuthKit's own metadata document, read once and reused; a stale copy is served while AuthKit cannot be read. */
  async function readAsMetadata(): Promise<Record<string, unknown>> {
    try {
      const res = await (deps.fetch ?? fetch)(`${config.issuer}/.well-known/oauth-authorization-server`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(5_000),
      });
      const body: unknown = res.ok ? await res.json() : null;
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new IssuerUnavailable();
      asMetadata = { at: Date.now(), body: body as Record<string, unknown> };
      return asMetadata.body;
    } catch {
      if (!asMetadata) throw new IssuerUnavailable();
      // Keep serving the stale copy, and try AuthKit again in a while rather
      // than on every request, each of which would wait for the timeout.
      asMetadata = { at: Date.now() - AS_METADATA_MAX_AGE_MS + AS_METADATA_RETRY_MS, body: asMetadata.body };
      return asMetadata.body;
    }
  }

  return {
    resource: config.resource,
    resourceMetadataUrl: config.resourceMetadataUrl,
    metadata: () => ({
      resource: config.resource,
      authorization_servers: [config.issuer],
      bearer_methods_supported: ['header'],
      resource_name: 'dForms',
    }),
    authorizationServerMetadata() {
      if (asMetadata && Date.now() - asMetadata.at < AS_METADATA_MAX_AGE_MS) return Promise.resolve(asMetadata.body);
      asInFlight ??= readAsMetadata().finally(() => {
        asInFlight = null;
      });
      return asInFlight;
    },
    async verify(token) {
      const claims = await verifyRs256(token, {
        issuer: config.issuer,
        audience: config.resource,
        keyFor: (kid) => jwks.keyFor(kid),
      });
      return claims ? { subject: claims.sub } : null;
    },
  };
}
