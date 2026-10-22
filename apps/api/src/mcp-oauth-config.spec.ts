/**
 * The MCP OAuth settings, checked at boot: off unless MCP_OAUTH_PROVIDER names
 * an adapter, and when it does, every value it needs present and well formed,
 * or the API refuses to start rather than serve a login that cannot work.
 */
import { describe, expect, it } from 'vitest';
import { loadServerEnv, mcpOAuth } from '@quill/config/env';
import { mcpOAuthSettings } from './mcp-oauth';

const ON = {
  MCP_OAUTH_PROVIDER: 'workos',
  WORKOS_AUTHKIT_DOMAIN: 'https://auth.example.test',
  MCP_PUBLIC_URL: 'https://mcp.example.test/mcp',
};

describe('MCP OAuth settings', () => {
  it('are off when no provider is named, or the name is blank, whatever else is set', () => {
    expect(mcpOAuth(loadServerEnv({}))).toBeNull();
    expect(mcpOAuth(loadServerEnv({ MCP_OAUTH_PROVIDER: '  ' }))).toBeNull();
    expect(mcpOAuth(loadServerEnv({ MCP_PUBLIC_URL: 'not a url', WORKOS_AUTHKIT_DOMAIN: 'nope' }))).toBeNull();
  });

  it('name the issuer, the resource every token must be for, and where its metadata lives', () => {
    expect(mcpOAuth(loadServerEnv(ON))).toEqual({
      provider: 'workos',
      issuer: 'https://auth.example.test',
      resource: 'https://mcp.example.test/mcp',
      resourceMetadataUrl: 'https://mcp.example.test/.well-known/oauth-protected-resource/mcp',
    });
  });

  it('tolerate a trailing slash, and plain http on a loopback host only', () => {
    expect(
      mcpOAuth(loadServerEnv({ ...ON, WORKOS_AUTHKIT_DOMAIN: 'https://auth.example.test/', MCP_PUBLIC_URL: 'https://mcp.example.test/mcp/' })),
    ).toMatchObject({ issuer: 'https://auth.example.test', resource: 'https://mcp.example.test/mcp' });
    expect(
      mcpOAuth(loadServerEnv({ ...ON, WORKOS_AUTHKIT_DOMAIN: 'http://127.0.0.1:9000', MCP_PUBLIC_URL: 'http://localhost:4000/mcp' })),
    ).toMatchObject({ issuer: 'http://127.0.0.1:9000', resource: 'http://localhost:4000/mcp' });
  });

  it.each([
    ['an unknown provider', { MCP_OAUTH_PROVIDER: 'okta' }, /MCP_OAUTH_PROVIDER/],
    ['no issuer', { WORKOS_AUTHKIT_DOMAIN: undefined }, /WORKOS_AUTHKIT_DOMAIN is required/],
    ['a blank issuer', { WORKOS_AUTHKIT_DOMAIN: ' ' }, /WORKOS_AUTHKIT_DOMAIN is required/],
    ['no public URL', { MCP_PUBLIC_URL: undefined }, /MCP_PUBLIC_URL is required/],
    ['an issuer over plain http', { WORKOS_AUTHKIT_DOMAIN: 'http://auth.example.test' }, /WORKOS_AUTHKIT_DOMAIN must be https/],
    ['an issuer with a path', { WORKOS_AUTHKIT_DOMAIN: 'https://auth.example.test/oauth2' }, /WORKOS_AUTHKIT_DOMAIN must be an origin/],
    ['an issuer without a scheme', { WORKOS_AUTHKIT_DOMAIN: 'auth.example.test' }, /WORKOS_AUTHKIT_DOMAIN/],
    ['a public URL over plain http', { MCP_PUBLIC_URL: 'http://mcp.example.test/mcp' }, /MCP_PUBLIC_URL must be https/],
    ['a public URL that is not the /mcp endpoint', { MCP_PUBLIC_URL: 'https://mcp.example.test' }, /MCP_PUBLIC_URL must be the \/mcp endpoint/],
    ['a public URL with a query', { MCP_PUBLIC_URL: 'https://mcp.example.test/mcp?x=1' }, /MCP_PUBLIC_URL must be the \/mcp endpoint/],
    ['a public URL that is not a URL', { MCP_PUBLIC_URL: 'mcp' }, /MCP_PUBLIC_URL/],
  ])('refuse to boot with %s', (_name, over, message) => {
    expect(() => loadServerEnv({ ...ON, ...over } as NodeJS.ProcessEnv)).toThrow(/Refusing to boot/);
    expect(() => loadServerEnv({ ...ON, ...over } as NodeJS.ProcessEnv)).toThrow(message);
  });

  it('refuse to boot when the allowed MCP hosts leave out the public URL, compared the way the door compares a Host', () => {
    expect(() => mcpOAuthSettings(loadServerEnv({ ...ON, MCP_ALLOWED_HOSTS: 'api.example.test' }))).toThrow(
      /Refusing to boot: MCP_ALLOWED_HOSTS does not list mcp\.example\.test/,
    );
    expect(mcpOAuthSettings(loadServerEnv({ ...ON, MCP_ALLOWED_HOSTS: 'api.example.test, MCP.example.test:443' }))).not.toBeNull();
    expect(mcpOAuthSettings(loadServerEnv({}))).toBeNull();
  });
});
