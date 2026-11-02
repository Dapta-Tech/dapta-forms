/**
 * The MCP OAuth port: what the MCP server needs from the identity provider
 * that signs an MCP connection's token (see docs/adr/0001).
 *
 * dForms is only the resource server. It never runs a login, registers a
 * client or stores a token: the identity provider does all of that, and this
 * port only verifies the token a client presents and describes the resource
 * so the client can find the login (RFC 9728). The adapter is selected by
 * `MCP_OAUTH_PROVIDER`; with it unset there is no adapter and the MCP server
 * takes API keys only. Nothing outside the adapter knows which provider it is.
 */
import { mcpOAuth, type McpOAuthConfig, type ServerEnv } from '@quill/config/env';
import { hostnameOf } from '@quill/mcp';
import { createWorkosAuthKit } from './mcp-oauth.workos';

export { IssuerUnavailable } from './jwt-rs256';

/** A token that verified: who it names, in the identity provider's terms. */
export interface VerifiedAccess {
  /** The token's `sub`: the person, as the identity provider knows them. */
  subject: string;
  /**
   * The person's email, only when the token carries it AND says the identity
   * provider verified it (`email_verified: true`); null otherwise. Signed by
   * the issuer with the rest of the token, so it is never a value the client
   * or the person typed into dForms. It decides staff of the deployment
   * (`isStaffEmail`) and nothing else: members are never matched by email.
   */
  email: string | null;
}

/** The protected-resource metadata (RFC 9728) of the MCP endpoint. */
export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  resource_name: string;
}

export interface McpOAuth {
  /** The MCP endpoint as customers reach it: every token's audience. */
  readonly resource: string;
  /** Where `metadata()` is published; a 401 points clients at it. */
  readonly resourceMetadataUrl: string;
  metadata(): ProtectedResourceMetadata;
  /**
   * The identity provider's authorization server metadata (RFC 8414), as it
   * publishes it, for older clients that look for it on the MCP host itself.
   * Throws `IssuerUnavailable` when it cannot be read and none is cached.
   */
  authorizationServerMetadata(): Promise<Record<string, unknown>>;
  /**
   * The token's subject when it verifies, else null. Throws only
   * `IssuerUnavailable`, when the identity provider's keys cannot be read and
   * none are cached: an outage, not a bad token.
   */
  verify(token: string): Promise<VerifiedAccess | null>;
}

export interface McpOAuthDeps {
  fetch?: typeof fetch;
}

/**
 * The MCP OAuth settings the API boots with (`mcpOAuth`), or null when off,
 * plus one check that needs the door: with MCP_ALLOWED_HOSTS set, it must
 * list the host of MCP_PUBLIC_URL, compared exactly as the door compares a
 * request's `Host` (`hostnameOf`), or every signed-in request would be
 * refused. Throws "Refusing to boot" when it does not.
 */
export function mcpOAuthSettings(env: Pick<ServerEnv, 'MCP_OAUTH_PROVIDER' | 'WORKOS_AUTHKIT_DOMAIN' | 'MCP_PUBLIC_URL' | 'MCP_ALLOWED_HOSTS'>): McpOAuthConfig | null {
  const config = mcpOAuth(env);
  if (!config) return null;
  const allowed = (env.MCP_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => hostnameOf(h))
    .filter(Boolean);
  const host = hostnameOf(new URL(config.resource).host);
  if (allowed.length > 0 && !allowed.includes(host)) {
    throw new Error(
      `Refusing to boot: MCP_ALLOWED_HOSTS does not list ${host}, the host of MCP_PUBLIC_URL, so every signed-in request would be refused.`,
    );
  }
  return config;
}

/** The configured adapter, or null when MCP OAuth is off. */
export function createMcpOAuth(config: McpOAuthConfig | null, deps: McpOAuthDeps = {}): McpOAuth | null {
  if (!config) return null;
  switch (config.provider) {
    case 'workos':
      return createWorkosAuthKit(config, deps);
  }
}
