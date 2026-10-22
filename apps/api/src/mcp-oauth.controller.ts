import { Controller, Get, Inject, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { ServerEnv } from '@quill/config/env';
import { IssuerUnavailable, type McpOAuth, type ProtectedResourceMetadata } from './mcp-oauth';
import { ENV, MCP_OAUTH } from './tokens';

/**
 * Where an MCP client discovers the login. Public and credential-free by
 * design, and not found while MCP OAuth is off or the MCP endpoint is
 * disabled.
 *
 * - `/.well-known/oauth-protected-resource/mcp`: the protected-resource
 *   metadata of the MCP endpoint (RFC 9728), the document a 401 from `/mcp`
 *   points at, naming the identity provider as the authorization server.
 * - `/.well-known/oauth-protected-resource`: the same document at the root,
 *   for clients that look there instead of under the endpoint's path.
 * - `/.well-known/oauth-authorization-server`: the identity provider's own
 *   authorization server metadata (RFC 8414), forwarded, for older clients
 *   (protocol 2025-03-26) that look for it on the MCP host. dForms is not the
 *   authorization server; the document names the provider's endpoints.
 *
 * The MCP host must route `/.well-known/*` to the API, not only `/mcp`.
 */
@Controller('.well-known')
export class McpOAuthMetadataController {
  constructor(
    @Inject(ENV) private readonly env: ServerEnv,
    @Inject(MCP_OAUTH) private readonly oauth: McpOAuth | null,
  ) {}

  @Get('oauth-protected-resource/mcp')
  metadata(): ProtectedResourceMetadata {
    return this.on().metadata();
  }

  @Get('oauth-protected-resource')
  rootMetadata(): ProtectedResourceMetadata {
    return this.on().metadata();
  }

  @Get('oauth-authorization-server')
  async authorizationServer(): Promise<Record<string, unknown>> {
    const oauth = this.on();
    try {
      return await oauth.authorizationServerMetadata();
    } catch (error) {
      if (error instanceof IssuerUnavailable) {
        throw new ServiceUnavailableException({ error: 'UNAVAILABLE', message: 'The sign-in service cannot be reached right now. Try again in a minute.' });
      }
      throw error;
    }
  }

  private on(): McpOAuth {
    if (!this.oauth || !this.env.MCP_ENABLED) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    return this.oauth;
  }
}
