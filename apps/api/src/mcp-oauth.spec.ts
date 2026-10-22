/**
 * The MCP OAuth adapter's token check, against a key pair generated here and
 * served as the issuer's JWKS: RS256 only, `iss` and `aud` exactly as
 * configured, `sub` and `exp` required. Anything else is null (a 401 at the
 * door), never a throw, except an issuer whose keys cannot be read with none
 * cached: `IssuerUnavailable` (a 503).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { IssuerUnavailable, createMcpOAuth, type McpOAuth } from './mcp-oauth';
import { startFakeIdentityProvider, type FakeIdentityProvider } from './fake-identity-provider';

const RESOURCE = 'https://mcp.example.test/mcp';
let idp: FakeIdentityProvider;
let oauth: McpOAuth;

beforeAll(async () => {
  idp = await startFakeIdentityProvider();
  oauth = createMcpOAuth({
    provider: 'workos',
    issuer: idp.issuer,
    resource: RESOURCE,
    resourceMetadataUrl: 'https://mcp.example.test/.well-known/oauth-protected-resource/mcp',
  })!;
});
afterAll(async () => {
  await idp.close();
});

const now = () => Math.floor(Date.now() / 1000);

describe('the MCP OAuth adapter', () => {
  it('is absent when no provider is configured', () => {
    expect(createMcpOAuth(null)).toBeNull();
  });

  it('names the issuer as the authorization server of the resource', () => {
    expect(oauth.metadata()).toEqual({
      resource: RESOURCE,
      authorization_servers: [idp.issuer],
      bearer_methods_supported: ['header'],
      resource_name: 'dForms',
    });
  });

  it('accepts a token the issuer signed for this resource, and names its subject', async () => {
    expect(await oauth.verify(idp.token('user_A', RESOURCE))).toEqual({ subject: 'user_A' });
    expect(await oauth.verify(idp.token('user_A', [RESOURCE, 'https://other.example.test'] as never))).toEqual({ subject: 'user_A' });
  });

  it.each([
    ['another issuer', { iss: 'https://evil.example.test' }],
    ['another audience', { aud: 'https://other.example.test/mcp' }],
    ['an audience list without this resource', { aud: ['https://other.example.test/mcp'] }],
    ['an expired token', { exp: now() - 120 }],
    ['no exp', { exp: undefined }],
    ['a non-numeric exp', { exp: 'tomorrow' }],
    ['no sub', { sub: undefined }],
    ['an empty sub', { sub: '' }],
    ['a token not valid yet', { nbf: now() + 600 }],
  ])('refuses %s', async (_name, over) => {
    expect(await oauth.verify(idp.token('user_A', RESOURCE, over))).toBeNull();
  });

  it('refuses a token signed by another key, or under an algorithm other than RS256', async () => {
    const claims = { iss: idp.issuer, aud: RESOURCE, sub: 'user_A', exp: now() + 600 };
    expect(await oauth.verify(idp.forge(claims))).toBeNull();
    expect(await oauth.verify(idp.sign(claims, { alg: 'HS256' }))).toBeNull();
    expect(await oauth.verify(idp.sign(claims, { alg: 'none' }))).toBeNull();
    const [header, body] = idp.sign(claims).split('.');
    expect(await oauth.verify(`${header}.${body}.`)).toBeNull();
  });

  it('refuses garbage without throwing', async () => {
    for (const token of ['', 'abc', 'a.b.c', 'eyJhbGciOiJSUzI1NiJ9.e30', `${'a'.repeat(20_000)}.b.c`]) {
      expect(await oauth.verify(token), token.slice(0, 20)).toBeNull();
    }
  });

  it('finds a key the issuer rotated in, and does not refetch the keys for every unknown key id', async () => {
    idp.rotate();
    expect(await oauth.verify(idp.token('user_B', RESOURCE))).toEqual({ subject: 'user_B' });
    const before = idp.jwksFetches();
    for (let i = 0; i < 5; i += 1) {
      expect(await oauth.verify(idp.sign({ iss: idp.issuer, aud: RESOURCE, sub: 'x', exp: now() + 60 }, { kid: `unknown-${i}` }))).toBeNull();
    }
    expect(idp.jwksFetches() - before).toBeLessThanOrEqual(1);
  });

  it('reports the issuer unreachable, not the token bad, while it has no keys cached', async () => {
    const offline = createMcpOAuth({
      provider: 'workos',
      issuer: 'http://127.0.0.1:9',
      resource: RESOURCE,
      resourceMetadataUrl: 'https://mcp.example.test/.well-known/oauth-protected-resource/mcp',
    })!;
    await expect(offline.verify(idp.token('user_A', RESOURCE))).rejects.toBeInstanceOf(IssuerUnavailable);
    // Garbage is still just garbage: refused before any key is looked up.
    expect(await offline.verify('a.b.c')).toBeNull();
  });
});

describe('the authorization server metadata while AuthKit is down', () => {
  it('serves the stale copy, and reads AuthKit again only once in a while instead of on every request', async () => {
    let fetches = 0;
    let down = false;
    const fetchImpl = (async () => {
      fetches += 1;
      if (down) throw new TypeError('fetch failed');
      return new Response(JSON.stringify({ issuer: 'https://issuer.example.test' }), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    let t = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => t);
    try {
      const as = createMcpOAuth(
        { provider: 'workos', issuer: 'https://issuer.example.test', resource: RESOURCE, resourceMetadataUrl: `${RESOURCE}/meta` },
        { fetch: fetchImpl },
      )!;
      expect(await as.authorizationServerMetadata()).toEqual({ issuer: 'https://issuer.example.test' });
      down = true;
      t += 11 * 60_000;
      for (let i = 0; i < 10; i++) expect(await as.authorizationServerMetadata()).toEqual({ issuer: 'https://issuer.example.test' });
      expect(fetches).toBe(2);
      t += 31_000;
      await as.authorizationServerMetadata();
      expect(fetches).toBe(3);
    } finally {
      clock.mockRestore();
    }
  });
});
